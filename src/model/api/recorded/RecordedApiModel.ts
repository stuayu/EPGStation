import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import FileUtil from '../../../util/FileUtil';
import IChannelDB from '../../db/IChannelDB';
import IRecordedDB, { FindAllOption } from '../../db/IRecordedDB';
import IWatchHistoryDB from '../../db/IWatchHistoryDB';
import ISeriesDB from '../../db/ISeriesDB';
import IVideoFileTsInfoDB from '../../db/IVideoFileTsInfoDB';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import IIPCClient from '../../ipc/IIPCClient';
import EDCBErrParser from '../../recorded/import/EDCBErrParser';
import EDCBFileNameParser from '../../recorded/import/EDCBFileNameParser';
import EDCBProgramTxtParser from '../../recorded/import/EDCBProgramTxtParser';
import ImportDirectoryScanner from '../../recorded/import/ImportDirectoryScanner';
import ImportPathValidator from '../../recorded/import/ImportPathValidator';
import IEncodeManageModel from '../../service/encode/IEncodeManageModel';
import { UploadedVideoFileOption } from '../../operator/recorded/IRecordedManageModel';
import ITsInfoAnalyzer, { TsInfo } from '../../recorded/ts/ITsInfoAnalyzer';
import IRecordedItemUtil from '../IRecordedItemUtil';
import IRecordedApiModel, { NextUpOption, NextUpResult } from './IRecordedApiModel';

@injectable()
export default class RecordedApiModel implements IRecordedApiModel {
    private ipc: IIPCClient;
    private recordedDB: IRecordedDB;
    private encodeManage: IEncodeManageModel;
    private recordedItemUtil: IRecordedItemUtil;
    private configuration: IConfiguration;
    private watchHistoryDB: IWatchHistoryDB;
    private seriesDB: ISeriesDB;
    private channelDB: IChannelDB;
    private tsInfoAnalyzer: ITsInfoAnalyzer;
    private videoFileTsInfoDB: IVideoFileTsInfoDB;

    constructor(
        @inject('IIPCClient') ipc: IIPCClient,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IEncodeManageModel') encodeManage: IEncodeManageModel,
        @inject('IRecordedItemUtil') recordedItemUtil: IRecordedItemUtil,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IWatchHistoryDB') watchHistoryDB: IWatchHistoryDB,
        @inject('ISeriesDB') seriesDB: ISeriesDB,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('ITsInfoAnalyzer') tsInfoAnalyzer: ITsInfoAnalyzer,
        @inject('IVideoFileTsInfoDB') videoFileTsInfoDB: IVideoFileTsInfoDB,
    ) {
        this.recordedDB = recordedDB;
        this.ipc = ipc;
        this.encodeManage = encodeManage;
        this.recordedItemUtil = recordedItemUtil;
        this.configuration = configuration;
        this.watchHistoryDB = watchHistoryDB;
        this.seriesDB = seriesDB;
        this.channelDB = channelDB;
        this.tsInfoAnalyzer = tsInfoAnalyzer;
        this.videoFileTsInfoDB = videoFileTsInfoDB;
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

    public async getNextUp(
        recordedId: apid.RecordedId,
        isHalfWidth: boolean,
        option: NextUpOption = {},
    ): Promise<NextUpResult | null> {
        if (!isFeatureEnabled(this.configuration.getConfig(), 'nextUpPanel'))
            throw new Error('NextUpPanelFeatureIsDisabled');
        const current = await this.recordedDB.findId(recordedId);
        if (current === null) return null;

        // 1 ページ分の件数。端末 (特にスマートフォン) の描画負荷を抑えるため上限を設ける
        const limit = Math.min(
            typeof option.limit === 'number' && option.limit > 0
                ? Math.floor(option.limit)
                : RecordedApiModel.NEXT_UP_DEFAULT_LIMIT,
            RecordedApiModel.NEXT_UP_MAX_LIMIT,
        );
        const offset = typeof option.offset === 'number' && option.offset > 0 ? Math.floor(option.offset) : 0;
        const target = option.target ?? 'all';

        let latest: apid.RecordedItem[] = [];
        let hasMoreLatest = false;
        if (target === 'all' || target === 'latest') {
            // 再生中の録画が混ざる分を見越して 1 件多く引き、続きの有無も同時に判定する
            const recentOption = { isHalfWidth, offset, limit: limit + 2, isReverse: false } as FindAllOption;
            recentOption.isRecording = false;
            const [recentRecords] = await this.recordedDB.findAll(recentOption, {
                isNeedVideoFiles: true,
                // パネルの一覧はサムネイル付きで表示する
                isNeedThumbnails: true,
                isNeedsDropLog: false,
                isNeedTags: false,
            });
            const filtered = recentRecords.filter(x => x.id !== recordedId);
            hasMoreLatest = filtered.length > limit;
            latest = await this.toRecordedItems(filtered.slice(0, limit), isHalfWidth);
        }

        const link = await this.seriesDB.findLink(recordedId);
        let currentSeriesId: number | null = null;
        let series: apid.RecordedItem[] = [];
        let hasMoreSeries = false;
        if (link !== null) {
            currentSeriesId = link.seriesId;
            if (target === 'all' || target === 'series') {
                // シリーズの紐付けは 1 作品分なので全件引いてから切り出す
                const allRows = (await this.seriesDB.listRecorded(link.seriesId)).filter(
                    x => x.recordedId !== recordedId,
                );
                const rows = allRows.slice(offset, offset + limit);
                hasMoreSeries = allRows.length > offset + rows.length;
                const seriesRecords = await this.recordedDB.findIds(
                    rows.map(x => x.recordedId),
                    { isNeedVideoFiles: true, isNeedThumbnails: true, isNeedsDropLog: false, isNeedTags: false },
                    true,
                );
                const index = new Map(seriesRecords.map(x => [x.id, x]));
                series = await this.toRecordedItems(
                    rows.map(x => index.get(x.recordedId)).filter((x): x is NonNullable<typeof x> => x !== undefined),
                    isHalfWidth,
                );
            }
        }
        return { currentSeriesId, latest, series, hasMoreLatest, hasMoreSeries };
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
        await this.attachSeriesInfo(items);
        await this.attachTsChannelNames(items);
        return items;
    }

    /**
     * 録画一覧へ TS 解析 (SDT) で読み取った放送局名をまとめて付与する。
     * 実際に録画されたストリームに入っていた名前なので、表示ではこれを最優先で使う。
     * 1 クエリでまとめて引くので件数が増えても N+1 にならない
     * @param items: apid.RecordedItem[]
     */
    private async attachTsChannelNames(items: apid.RecordedItem[]): Promise<void> {
        if (items.length === 0) return;
        try {
            const index = await this.videoFileTsInfoDB.findServiceNamesByRecordedIds(items.map(item => item.id));
            if (index.size === 0) return;
            for (const item of items) {
                const name = index.get(item.id);
                if (typeof name === 'string') item.tsChannelName = name;
            }
        } catch (err) {
            // 解析結果が引けなくても従来の放送局名で表示できるため、付与を諦めるだけにする
            console.error(err);
        }
    }

    /**
     * 録画一覧へシリーズ・エピソード情報 (話数・サブタイトル・放送回コメント) をまとめて付与する。
     * 一覧のタイトル表示を「辞書のエピソード名」に切り替えられるようにするために使う。
     * 1 クエリでまとめて引くので件数が増えても N+1 にならない
     * @param items: apid.RecordedItem[]
     */
    private async attachSeriesInfo(items: apid.RecordedItem[]): Promise<void> {
        if (!isFeatureEnabled(this.configuration.getConfig(), 'seriesLibrary')) return;
        if (items.length === 0) return;
        try {
            const index = await this.seriesDB.findSeriesInfoByRecordedIds(items.map(item => item.id));
            if (index.size === 0) return;
            for (const item of items) {
                const info = index.get(item.id);
                if (typeof info === 'undefined') continue;
                item.series = {
                    ...info,
                    episodeCommentSource: info.episodeCommentSource as apid.RecordedSeriesInfo['episodeCommentSource'],
                };
            }
        } catch (err) {
            // シリーズ情報が引けなくても録画一覧そのものは返せるため、付与を諦めるだけにする
            console.error(err);
        }
    }

    /**
     * 外部録画ファイル取り込みディレクトリをスキャンし、取り込み候補を返す (読み取り専用、DB/実ファイルの変更は行わない)
     * @param option: apid.ImportScanOption
     * @return Promise<apid.ImportScanResult>
     */
    public async scanImportDirectory(option: apid.ImportScanOption): Promise<apid.ImportScanResult> {
        if (!isFeatureEnabled(this.configuration.getConfig(), 'externalFileImport')) {
            throw new Error('ExternalFileImportFeatureIsDisabled');
        }

        const config = this.configuration.getConfig();
        const importDirs = config.importDirs ?? [];
        // importDirs ごと未設定の場合と、名前が見つからない場合を区別する。
        // 前者は config.yml の設定漏れ (EDCB 録画の取り込みで最も多い原因) なので、
        // ImportDirNotFound ではなく専用のエラーを返して原因を切り分けられるようにする
        if (importDirs.length === 0) {
            throw new Error('ImportDirsNotConfigured');
        }
        const dir = importDirs.find(d => d.name === option.importDirName);
        if (typeof dir === 'undefined') {
            throw new Error('ImportDirNotFound');
        }

        if (typeof option.subPath !== 'undefined') {
            ImportPathValidator.validateSubDirectory(option.subPath);
        }

        const targetDirPath = typeof option.subPath === 'string' ? path.join(dir.path, option.subPath) : dir.path;

        // importDirs 配下であることを再検証する (subPath によるトラバーサル対策の多層防御)
        const resolvedDir = await ImportPathValidator.resolveImportTargetPath(targetDirPath, importDirs).catch(
            () => null,
        );
        if (resolvedDir === null) {
            throw new Error('ImportPathNotAllowed');
        }

        const candidates = await ImportDirectoryScanner.scan(resolvedDir.realPath, option.recursive ?? true);
        const channels = await this.channelDB.findAll();

        // analyze を false にすると TS 解析・重複判定を行わずファイルの列挙だけを返す
        // (アップロード画面でサーバー上のファイルを選ぶだけの用途では番組情報の推定が不要なため)
        const analyze = option.analyze !== false;

        const items: apid.ImportScanResultItem[] = [];
        for (const candidate of candidates) {
            const item =
                analyze === true
                    ? await this.toScanResultItem(candidate, channels)
                    : await RecordedApiModel.toFileListItem(candidate);
            items.push(item);
        }

        return { items };
    }

    /**
     * スキャン候補 1 件分を、TS 解析を行わないファイル情報だけの item に変換する
     * @param candidate: ImportDirectoryScanner.CandidateFile
     * @return Promise<apid.ImportScanResultItem>
     */
    private static async toFileListItem(
        candidate: ImportDirectoryScanner.CandidateFile,
    ): Promise<apid.ImportScanResultItem> {
        const item: apid.ImportScanResultItem = {
            filePath: candidate.filePath,
            fileName: candidate.fileName,
            hasProgramTxt: candidate.programTxtPath !== null,
            hasErr: candidate.errPath !== null,
        };

        try {
            item.size = await FileUtil.getFileSize(candidate.filePath);
        } catch (err: any) {
            // 取得できなくても無視する
        }

        return item;
    }

    /**
     * スキャン候補の TS を解析する
     * スキャンは一覧表示のための下準備なので、失敗しても候補自体は返す
     * @param filePath: string 実ファイルパス
     * @return Promise<TsInfo | null>
     */
    private async analyzeTsInfoForScan(filePath: string): Promise<TsInfo | null> {
        // TS 以外の拡張子には PSI/SI が無い
        if (RecordedApiModel.TS_EXTENSIONS.includes(path.extname(filePath).toLowerCase()) === false) {
            return null;
        }

        try {
            return await this.tsInfoAnalyzer.analyze(filePath, {
                timeoutMs: RecordedApiModel.SCAN_TS_ANALYZE_TIMEOUT_MS,
            });
        } catch (err: any) {
            // 壊れたファイルでも一覧には出す
            return null;
        }
    }

    /**
     * スキャン候補 1 件分を apid.ImportScanResultItem に変換する
     */
    private async toScanResultItem(
        candidate: ImportDirectoryScanner.CandidateFile,
        channels: { id: apid.ChannelId; name: string; halfWidthName: string }[],
    ): Promise<apid.ImportScanResultItem> {
        const parsedName = path.parse(candidate.fileName);
        let name: string | undefined = parsedName.name;
        let channelName: string | undefined;
        let startAt: number | undefined;
        let endAt: number | undefined;

        const fileNameResult = EDCBFileNameParser.parse(
            parsedName.name,
            this.configuration.getConfig().importFileNamePatterns ?? [],
        );
        if (fileNameResult !== null) {
            if (typeof fileNameResult.name === 'string') name = fileNameResult.name;
            channelName = fileNameResult.channelName;
            startAt = fileNameResult.startAt;
        }

        if (candidate.programTxtPath !== null) {
            try {
                const content = await FileUtil.readFile(candidate.programTxtPath);
                const parsed = EDCBProgramTxtParser.parse(content);
                if (typeof parsed.name === 'string') name = parsed.name;
                if (typeof parsed.channelName === 'string') channelName = parsed.channelName;
                if (typeof parsed.startAt === 'number') startAt = parsed.startAt;
                if (typeof parsed.endAt === 'number') endAt = parsed.endAt;
            } catch (err: any) {
                // 読み取り失敗時は無視する
            }
        }

        // 情報源の優先順位は TS > program.txt > ファイル名。
        // TS の PSI/SI は実体そのものなので、取れた項目はすべて上書きする
        let estimatedSource: apid.ImportEstimatedSource = 'fileName';
        if (candidate.programTxtPath !== null) {
            estimatedSource = 'programTxt';
        }

        const tsInfo = await this.analyzeTsInfoForScan(candidate.filePath);
        if (tsInfo !== null) {
            if (tsInfo.eventName !== null) {
                name = tsInfo.eventName;
                estimatedSource = 'ts';
            }
            if (tsInfo.serviceName !== null) {
                channelName = tsInfo.serviceName;
                estimatedSource = 'ts';
            }
            if (tsInfo.eventStartAt !== null) {
                startAt = tsInfo.eventStartAt;
                endAt = tsInfo.eventDuration === null ? endAt : tsInfo.eventStartAt + tsInfo.eventDuration * 1000;
                estimatedSource = 'ts';
            }
        }

        let dropCount: number | undefined;
        let scramblingCount: number | undefined;
        if (candidate.errPath !== null) {
            try {
                const content = await FileUtil.readFile(candidate.errPath);
                const parsed = EDCBErrParser.parse(content);
                dropCount = parsed.dropCount;
                scramblingCount = parsed.scramblingCount;
            } catch (err: any) {
                // 読み取り失敗時は無視する
            }
        }

        // 放送局は TS の network id + service id での厳密な引き当てを最優先し、
        // 取れない場合のみ従来どおり放送局名の曖昧一致で探す
        let channel: { id: apid.ChannelId } | undefined;
        if (tsInfo !== null && tsInfo.networkId !== null && tsInfo.serviceId !== null) {
            const found = await this.channelDB
                .findNetworkIdAndServiceId(tsInfo.networkId, tsInfo.serviceId)
                .catch(() => null);
            if (found !== null) {
                channel = found;
            }
        }
        if (typeof channel === 'undefined' && typeof channelName === 'string') {
            channel = channels.find(
                c =>
                    c.name === channelName || c.halfWidthName === channelName || c.name.includes(channelName as string),
            );
        }

        let duplicateRecordedIds: apid.RecordedId[] | undefined;
        if (typeof channel !== 'undefined' && typeof startAt === 'number') {
            const duplicates = await this.recordedDB.findDuplicateCandidates(
                channel.id,
                startAt,
                RecordedApiModel.DUPLICATE_TOLERANCE_MS,
            );
            if (duplicates.length > 0) {
                duplicateRecordedIds = duplicates.map(d => d.id);
            }
        }

        let size: number | undefined;
        try {
            size = await FileUtil.getFileSize(candidate.filePath);
        } catch (err: any) {
            // 取得できなくても無視する
        }

        const item: apid.ImportScanResultItem = {
            filePath: candidate.filePath,
            fileName: candidate.fileName,
            hasProgramTxt: candidate.programTxtPath !== null,
            hasErr: candidate.errPath !== null,
        };
        if (typeof size === 'number') item.size = size;
        if (typeof name === 'string') item.estimatedName = name;
        if (typeof channelName === 'string') item.estimatedChannelName = channelName;
        if (typeof channel !== 'undefined') item.estimatedChannelId = channel.id;
        if (typeof startAt === 'number') item.estimatedStartAt = startAt;
        if (typeof endAt === 'number') item.estimatedEndAt = endAt;
        item.estimatedSource = estimatedSource;
        if (tsInfo !== null) {
            if (tsInfo.serviceName !== null) item.tsServiceName = tsInfo.serviceName;
            if (tsInfo.eventName !== null) item.tsEventName = tsInfo.eventName;
            if (tsInfo.networkId !== null) item.tsNetworkId = tsInfo.networkId;
            if (tsInfo.serviceId !== null) item.tsServiceId = tsInfo.serviceId;
        }
        if (typeof dropCount === 'number') item.dropCount = dropCount;
        if (typeof scramblingCount === 'number') item.scramblingCount = scramblingCount;
        if (typeof duplicateRecordedIds !== 'undefined') item.duplicateRecordedIds = duplicateRecordedIds;

        return item;
    }

    /**
     * 外部録画ファイル取り込みジョブを開始する (実際の登録処理は IPC 経由で Operator が行う)
     * @param option: apid.ImportRegisterOption
     * @return Promise<apid.ImportJobStartResult>
     */
    public async startImportJob(option: apid.ImportRegisterOption): Promise<apid.ImportJobStartResult> {
        if (!isFeatureEnabled(this.configuration.getConfig(), 'externalFileImport')) {
            throw new Error('ExternalFileImportFeatureIsDisabled');
        }

        if (option.items.length === 0) {
            throw new Error('ImportItemsAreEmpty');
        }

        const items = option.items.map(item => ({
            localFilePath: item.filePath,
            parentDirectoryName: item.parentDirectoryName,
            subDirectory: item.subDirectory,
            fileType: item.fileType,
            channelId: item.channelId,
            mode: item.mode,
            name: item.name,
            startAt: item.startAt,
            endAt: item.endAt,
            duplicateAction: item.duplicateAction,
            duplicateRecordedId: item.duplicateRecordedId,
            ruleId: item.ruleId,
            genre1: item.genre1,
            subGenre1: item.subGenre1,
        }));

        const jobId = await this.ipc.recorded.startImportJob(items);

        return { jobId };
    }

    /**
     * 取り込みジョブの進捗を取得する
     * @param jobId: string
     * @return Promise<apid.ImportJobStatus | null>
     */
    public async getImportJobStatus(jobId: string): Promise<apid.ImportJobStatus | null> {
        if (!isFeatureEnabled(this.configuration.getConfig(), 'externalFileImport')) {
            throw new Error('ExternalFileImportFeatureIsDisabled');
        }

        return this.ipc.recorded.getImportJobStatus(jobId);
    }

    /**
     * 取り込みジョブの失敗ファイルのみを再実行する
     * @param jobId: string
     * @return Promise<apid.ImportJobStartResult | null>
     */
    public async retryImportJob(jobId: string): Promise<apid.ImportJobStartResult | null> {
        if (!isFeatureEnabled(this.configuration.getConfig(), 'externalFileImport')) {
            throw new Error('ExternalFileImportFeatureIsDisabled');
        }

        const newJobId = await this.ipc.recorded.retryImportJob(jobId);

        return newJobId === null ? null : { jobId: newJobId };
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
    public async addUploadedVideoFile(option: UploadedVideoFileOption): Promise<apid.RecordedId> {
        // サーバー上のファイルを直接指定する場合は importDirs 配下に限定する。
        // 指定されたパスのファイルは録画ディレクトリへ移動される (元の場所から消える) ため、
        // 任意のパスを受け付けると無関係なファイルを動かせてしまう
        if (typeof option.localFilePath === 'string' && option.localFilePath.length > 0) {
            const config = this.configuration.getConfig();
            const resolved = await ImportPathValidator.resolveImportTargetPath(
                option.localFilePath,
                config.importDirs ?? [],
            );
            option.localFilePath = resolved.realPath;
        }

        return await this.ipc.recorded.addUploadedVideoFile(option);
    }

    /**
     * 録画番組情報を新規作成
     * @param option: apid.CreateNewRecordedOption
     * @return Promise<apid.RecordedId>
     */
    public async createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId> {
        return await this.ipc.recorded.createNewRecorded(option);
    }

    // 外部録画ファイル取り込みの重複判定に使う時刻許容誤差 (ms)
    // 次に見る候補の 1 ページ分の既定件数 / 上限件数
    private static readonly NEXT_UP_DEFAULT_LIMIT = 20;
    private static readonly NEXT_UP_MAX_LIMIT = 100;
    private static readonly DUPLICATE_TOLERANCE_MS = 5 * 60 * 1000;
    // スキャンでは候補が多いこともあるため、1 件あたりの TS 解析は短めで打ち切る
    private static readonly SCAN_TS_ANALYZE_TIMEOUT_MS = 10 * 1000;
    // TS の PSI/SI を持ちうる拡張子
    private static readonly TS_EXTENSIONS = ['.ts', '.m2ts', '.mts', '.m2t'];
}
