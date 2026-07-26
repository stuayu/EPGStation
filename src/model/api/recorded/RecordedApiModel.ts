import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IRecordedDB, { FindAllOption } from '../../db/IRecordedDB';
import IWatchHistoryDB from '../../db/IWatchHistoryDB';
import ISeriesDB from '../../db/ISeriesDB';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import IIPCClient from '../../ipc/IIPCClient';
import { UploadedVideoFileOption } from '../../operator/recorded/IRecordedManageModel';
import IEncodeManageModel from '../../service/encode/IEncodeManageModel';
import IRecordedItemUtil from '../IRecordedItemUtil';
import IRecordedApiModel, { NextUpResult } from './IRecordedApiModel';

@injectable()
export default class RecordedApiModel implements IRecordedApiModel {
    private ipc: IIPCClient;
    private recordedDB: IRecordedDB;
    private encodeManage: IEncodeManageModel;
    private recordedItemUtil: IRecordedItemUtil;
    private configuration: IConfiguration;
    private watchHistoryDB: IWatchHistoryDB;
    private seriesDB: ISeriesDB;

    constructor(
        @inject('IIPCClient') ipc: IIPCClient,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IEncodeManageModel') encodeManage: IEncodeManageModel,
        @inject('IRecordedItemUtil') recordedItemUtil: IRecordedItemUtil,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IWatchHistoryDB') watchHistoryDB: IWatchHistoryDB,
        @inject('ISeriesDB') seriesDB: ISeriesDB,
    ) {
        this.recordedDB = recordedDB;
        this.ipc = ipc;
        this.encodeManage = encodeManage;
        this.recordedItemUtil = recordedItemUtil;
        this.configuration = configuration;
        this.watchHistoryDB = watchHistoryDB;
        this.seriesDB = seriesDB;
    }

    /**
     * 録画情報の取得
     * @param option: GetRecordedOption
     * @return Promise<apid.Records>
     */
    public async gets(option: apid.GetRecordedOption): Promise<apid.Records> {
        (<FindAllOption>option).isRecording = false;
        const [records, total] = await this.recordedDB.findAll(option, {
            isNeedVideoFiles: true,
            isNeedThumbnails: true,
            isNeedsDropLog: true,
            isNeedTags: false,
        });

        const items = await this.toRecordedItems(records, option.isHalfWidth);
        return { records: items, total };
    }

    /**
     * 指定した recorded id の録画情報を取得する
     * @param recordedId: apid.RecordedId
     * @param isHalfWidth: boolean 半角文字で返すか
     * @return Promise<apid.RecordedItem | null> null の場合録画情報が存在しない
     */
    public async get(recordedId: apid.RecordedId, isHalfWidth: boolean): Promise<apid.RecordedItem | null> {
        const item = await this.recordedDB.findId(recordedId);

        const encodeIndex = this.encodeManage.getRecordedIndex();

        if (item === null) return null;
        const [result] = await this.toRecordedItems([item], isHalfWidth, encodeIndex);
        return result;
    }

    public async getNextUp(recordedId: apid.RecordedId, isHalfWidth: boolean): Promise<NextUpResult | null> {
        if (!isFeatureEnabled(this.configuration.getConfig(), 'nextUpPanel'))
            throw new Error('NextUpPanelFeatureIsDisabled');
        const current = await this.recordedDB.findId(recordedId);
        if (current === null) return null;
        const recentOption = { isHalfWidth, offset: 0, limit: 9, isReverse: false } as FindAllOption;
        recentOption.isRecording = false;
        const [recentRecords] = await this.recordedDB.findAll(recentOption, {
            isNeedVideoFiles: true,
            isNeedThumbnails: false,
            isNeedsDropLog: false,
            isNeedTags: false,
        });
        const latest = (
            await this.toRecordedItems(
                recentRecords.filter(x => x.id !== recordedId),
                isHalfWidth,
            )
        ).slice(0, 8);

        const link = await this.seriesDB.findLink(recordedId);
        let currentSeriesId: number | null = null;
        let series: apid.RecordedItem[] = [];
        if (link !== null) {
            currentSeriesId = link.seriesId;
            const rows = (await this.seriesDB.listRecorded(link.seriesId))
                .filter(x => x.recordedId !== recordedId)
                .slice(0, 8);
            const seriesRecords = await this.recordedDB.findIds(
                rows.map(x => x.recordedId),
                { isNeedVideoFiles: true, isNeedThumbnails: false, isNeedsDropLog: false, isNeedTags: false },
                true,
            );
            const index = new Map(seriesRecords.map(x => [x.id, x]));
            series = await this.toRecordedItems(
                rows.map(x => index.get(x.recordedId)).filter((x): x is NonNullable<typeof x> => x !== undefined),
                isHalfWidth,
            );
        }
        return { currentSeriesId, latest, series };
    }

    private async toRecordedItems(
        records: any[],
        isHalfWidth: boolean,
        encodeIndex = this.encodeManage.getRecordedIndex(),
    ): Promise<apid.RecordedItem[]> {
        const items = records.map(r =>
            this.recordedItemUtil.convertRecordedToRecordedItem(r, isHalfWidth, encodeIndex),
        );
        await this.attachWatchHistories(items);
        return items;
    }
    private async attachWatchHistories(items: apid.RecordedItem[]): Promise<void> {
        if (!isFeatureEnabled(this.configuration.getConfig(), 'watchHistory')) return;
        const videoFiles = items.flatMap(item => item.videoFiles ?? []);
        const histories = await this.watchHistoryDB.findByVideoFileIds(videoFiles.map(video => video.id));
        const index = new Map(histories.map(history => [history.videoFileId, history]));
        for (const video of videoFiles) {
            const history = index.get(video.id);
            if (typeof history !== 'undefined') {
                video.watchHistory = {
                    videoFileId: history.videoFileId,
                    recordedId: history.recordedId,
                    position: history.position,
                    duration: history.duration,
                    status: history.status,
                    updatedAt: Number(history.updatedAt),
                };
            }
        }
    }

    /**
     * recorded の検索オプションリストを取得する
     * @return Promise<apid.RecordedSearchOptionList>
     */
    public async getSearchOptionList(): Promise<apid.RecordedSearchOptions> {
        const channels = await this.recordedDB.findChannelList();
        const genres = await this.recordedDB.findGenreList();

        return {
            channels: channels,
            genres: genres,
        };
    }

    /**
     *
     * @param recordedId: ReserveId
     * @return Promise<void>
     */
    public async delete(recordedId: apid.RecordedId): Promise<void> {
        await this.encodeManage.cancelEncodeByRecordedId(recordedId);

        return this.ipc.recorded.delete(recordedId);
    }

    /**
     * recordedId を指定してエンコードを停止させる
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public stopEncode(recordedId: apid.RecordedId): Promise<void> {
        return this.encodeManage.cancelEncodeByRecordedId(recordedId);
    }

    /**
     * 保護状態を変更する
     * @param recordedId: apid.RecordedId
     * @param isProtect: boolean
     * @return Promise<void>
     */
    public changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void> {
        return this.ipc.recorded.changeProtect(recordedId, isProtect);
    }

    /**
     * クリーンアップ削除候補情報を取得する (実削除は行わない)
     * @return Promise<apid.RecordedCleanupInfo>
     */
    public async getCleanupInfo(): Promise<apid.RecordedCleanupInfo> {
        return await this.ipc.recorded.getCleanupInfo();
    }

    /**
     * ファイルのクリーンアップ
     * @param target: apid.RecordedCleanupTarget 省略時は 'all' (録画実ファイル + ドロップログファイル)
     * dropLogOnly が指定された場合は録画実ファイルを削除せずドロップログファイルのみクリーンアップする
     */
    public async fileCleanup(target: apid.RecordedCleanupTarget = 'all'): Promise<void> {
        if (target === 'all') {
            await this.ipc.recorded.videoFileCleanup();
        }
        await this.ipc.recorded.dropLogFileCleanup();
    }

    /**
     * upload されたビデオファイルを追加する
     * @param option: UploadedVideoFileInfo
     * @return Promise<void>
     */
    public async addUploadedVideoFile(option: UploadedVideoFileOption): Promise<void> {
        await this.ipc.recorded.addUploadedVideoFile(option);
    }

    /**
     * 録画番組情報を新規作成
     * @param option: apid.CreateNewRecordedOption
     * @return Promise<apid.RecordedId>
     */
    public async createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId> {
        return await this.ipc.recorded.createNewRecorded(option);
    }
}
