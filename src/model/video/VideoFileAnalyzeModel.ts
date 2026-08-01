import { promises as fs } from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../api';
import VideoFile from '../../db/entities/VideoFile';
import VideoFileTsInfo from '../../db/entities/VideoFileTsInfo';
import StrUtil from '../../util/StrUtil';
import IVideoUtil from '../api/video/IVideoUtil';
import IBroadcastAffiliationCollector from '../channel/IBroadcastAffiliationCollector';
import IChannelDB from '../db/IChannelDB';
import IRecordedDB, { RecordedProgramUpdateValues } from '../db/IRecordedDB';
import IVideoFileDB from '../db/IVideoFileDB';
import IVideoFileTsInfoDB from '../db/IVideoFileTsInfoDB';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import ITsInfoAnalyzer, { TsInfo } from '../recorded/ts/ITsInfoAnalyzer';
import IVideoFileAnalyzeModel from './IVideoFileAnalyzeModel';

/**
 * 放送局の解決に必要な最小限の情報 (TS 解析結果 / 保存済みの ts_info のどちらからでも作れる)
 */
interface ChannelSource {
    networkId: number | null;
    serviceId: number | null;
    serviceName: string | null;
}

/**
 * 録画ファイルの解析をまとめて行う
 *
 * - ffprobe による実測メタデータ (尺・コーデック・解像度など) の取得
 * - TS の PSI/SI 解析による放送局・番組情報の取得
 *
 * Operator (取り込み時) と Service (API 経由) の両方から使うため、
 * プロセス固有の依存 (IPC 等) は持たない
 */
@injectable()
export default class VideoFileAnalyzeModel implements IVideoFileAnalyzeModel {
    // TS 解析の対象にする拡張子 (これ以外の完全な再マルチプレクスには PSI/SI が無い)
    private static readonly TS_FILE_EXTENSION = '.ts';

    private videoFileDB: IVideoFileDB;
    private videoFileTsInfoDB: IVideoFileTsInfoDB;
    private recordedDB: IRecordedDB;
    private videoUtil: IVideoUtil;
    private tsInfoAnalyzer: ITsInfoAnalyzer;
    private channelDB: IChannelDB;
    private log: ILogger | null;
    private affiliationCollector: IBroadcastAffiliationCollector | null;

    constructor(
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IVideoFileTsInfoDB') videoFileTsInfoDB: IVideoFileTsInfoDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
        @inject('ITsInfoAnalyzer') tsInfoAnalyzer: ITsInfoAnalyzer,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('ILoggerModel') logger?: ILoggerModel,
        @inject('IBroadcastAffiliationCollector') affiliationCollector?: IBroadcastAffiliationCollector,
    ) {
        this.videoFileDB = videoFileDB;
        this.videoFileTsInfoDB = videoFileTsInfoDB;
        this.recordedDB = recordedDB;
        this.videoUtil = videoUtil;
        this.tsInfoAnalyzer = tsInfoAnalyzer;
        this.channelDB = channelDB;
        this.log = typeof logger === 'undefined' ? null : logger.getLogger();
        this.affiliationCollector = typeof affiliationCollector === 'undefined' ? null : affiliationCollector;
    }

    /**
     * TS 解析と ffprobe 解析をまとめて実行する
     * 取り込み・アップロード直後に呼ぶ想定で、失敗しても例外は投げない
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async analyzeAll(videoFileId: apid.VideoFileId): Promise<void> {
        // TS 解析を先に行う。録画開始時刻 (TDT) が取れると ffprobe 側の startAt 推定より正確になる
        try {
            await this.analyzeTsInfo(videoFileId);
        } catch (err: any) {
            this.log?.system.warn(`ts info analysis failed: videoFileId ${videoFileId}: ${err?.message ?? err}`);
        }

        try {
            await this.analyzeMetadata(videoFileId);
        } catch (err: any) {
            this.log?.system.warn(`video metadata analysis failed: videoFileId ${videoFileId}: ${err?.message ?? err}`);
        }
    }

    /**
     * 指定した video file id の実ファイルを ffprobe で解析して DB に保存する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<apid.VideoFileMetadataResult>
     */
    public async analyzeMetadata(videoFileId: apid.VideoFileId): Promise<apid.VideoFileMetadataResult> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) {
            throw new Error('VideoFileIsUndefined');
        }

        const filePath = this.videoUtil.getFullFilePathFromVideoFile(video);
        if (filePath === null) {
            // config.yml の recorded に無いディレクトリ名を DB が指している場合に起きる
            throw new Error(
                `VideoFilePathIsUndefined (parentDirectoryName: ${video.parentDirectoryName}, filePath: ${video.filePath})`,
            );
        }

        const info = await this.videoUtil.getDetailedInfo(filePath);

        await this.videoFileDB.updateMetadata(videoFileId, {
            duration: info.duration > 0 ? info.duration : null,
            startTime: info.startTime,
            videoCodec: info.videoCodec,
            audioCodec: info.audioCodec,
            width: info.width,
            height: info.height,
            bitRate: info.bitRate > 0 ? info.bitRate : null,
            size: info.size,
        });

        // 録画ファイル先頭の実時刻が未記録なら推定して埋める
        let startAt = video.startAt === null || typeof video.startAt === 'undefined' ? null : Number(video.startAt);
        if (startAt === null) {
            startAt = await this.resolveStartAt(video, filePath, info.duration);
            if (startAt !== null) {
                await this.videoFileDB.updateStartAt(videoFileId, startAt);
            }
        }

        return {
            videoFileId: videoFileId,
            duration: info.duration > 0 ? info.duration : null,
            startTime: info.startTime,
            startAt: startAt,
            videoCodec: info.videoCodec,
            audioCodec: info.audioCodec,
            width: info.width,
            height: info.height,
            bitRate: info.bitRate > 0 ? info.bitRate : null,
            size: info.size > 0 ? info.size : video.size,
        };
    }

    /**
     * 指定した video file id の TS を解析して放送情報を DB に保存する
     *
     * 対象判定は video_file.type ではなく拡張子で行う。type はストリーミングパイプラインの
     * 選択 (StreamProfileManageModel.getRecordedProfiles) にも使われており、'ts' は
     * 「生の放送 TS を前提にしたパイプ入力・yadif 有りの変換経路」を意味するため、
     * tsreplace 系 (映像だけ差し替え済みでシーク可能、出力拡張子は .ts のまま) のような
     * type: 'encoded' でも PSI/SI を保持しているファイルを解析対象に含めるには、
     * type を書き換えるのではなく拡張子で別軸に判定する必要がある
     * @param videoFileId: apid.VideoFileId
     * @return Promise<boolean> 解析して保存した場合 true (TS を含まない拡張子の場合は false)
     */
    public async analyzeTsInfo(videoFileId: apid.VideoFileId): Promise<boolean> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) {
            throw new Error('VideoFileIsUndefined');
        }

        // 完全な再マルチプレクス (.mp4/.mkv 等) には PSI/SI が無い。拡張子が .ts の場合のみ解析する
        // (tsreplace 系のように type: 'encoded' でも .ts 拡張子なら対象に含む)
        if (path.extname(video.filePath).toLowerCase() !== VideoFileAnalyzeModel.TS_FILE_EXTENSION) {
            return false;
        }

        const filePath = this.videoUtil.getFullFilePathFromVideoFile(video);
        if (filePath === null) {
            throw new Error(
                `VideoFilePathIsUndefined (parentDirectoryName: ${video.parentDirectoryName}, filePath: ${video.filePath})`,
            );
        }

        const info = await this.tsInfoAnalyzer.analyze(filePath);
        await this.saveTsInfo(videoFileId, info);

        return true;
    }

    /**
     * 解析済みの TS 情報を保存する
     * 取り込み処理のように、登録前にファイルパスへ対して解析を済ませている場合に使う
     * @param videoFileId: apid.VideoFileId
     * @param info: TsInfo
     * @return Promise<void>
     */
    public async saveTsInfo(videoFileId: apid.VideoFileId, info: TsInfo): Promise<void> {
        await this.videoFileTsInfoDB.upsert(VideoFileAnalyzeModel.toEntity(videoFileId, info));

        // BIT が取れていれば放送局の系列情報を更新する (受動収集)
        if (this.affiliationCollector !== null && info.bitSections.length > 0) {
            await this.affiliationCollector.collect(info.bitSections).catch(err => {
                this.log?.system.error('collect broadcast affiliation error');
                this.log?.system.error(err.message);
            });
        }

        // TDT / TOT から録画開始時刻が分かった場合は、推定値より優先して記録する
        if (info.firstTdtAt !== null) {
            await this.videoFileDB.updateStartAt(videoFileId, info.firstTdtAt);
        }

        // 放送局が引けていない録画は「不明な放送局」と表示されるため、TS から分かった局名で補う
        await this.applyChannelInfo(videoFileId, info).catch(err => {
            this.log?.system.warn(`failed to apply channel info: videoFileId ${videoFileId}: ${err?.message ?? err}`);
        });

        // 番組情報 (概要・詳細・ジャンル・映像音声情報) が空の録画を EIT[p/f] の内容で補う
        await this.applyProgramInfo(videoFileId, info).catch(err => {
            this.log?.system.warn(`failed to apply program info: videoFileId ${videoFileId}: ${err?.message ?? err}`);
        });
    }

    /**
     * TS の EIT[p/f] から分かった番組情報を録画情報へ反映する。
     *
     * API 経由で録画情報だけ先に作り、後から動画ファイルを追加した録画 (外部連携での登録) は
     * 番組の概要・詳細・ジャンル・映像音声情報が空のままで、EPGStation が録画した番組と
     * 表示内容が大きく変わってしまう。TS を解析した時点でこれらを補う。
     *
     * すでに値が入っている項目は上書きしない (画面から入力した内容・EPG 由来の値を壊さない)
     * @param videoFileId: apid.VideoFileId
     * @param info: TsInfo
     * @return Promise<boolean> 何らかの項目を補完した場合 true
     */
    private async applyProgramInfo(videoFileId: apid.VideoFileId, info: TsInfo): Promise<boolean> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) return false;

        const recorded = await this.recordedDB.findId(video.recordedId);
        if (recorded === null) return false;

        const values: RecordedProgramUpdateValues = {};

        // 番組名は「ファイル名のまま」の場合があるが、利用者が付けた名前を勝手に変えないため触らない
        if (VideoFileAnalyzeModel.isEmpty(recorded.description) === true && info.eventDescription !== null) {
            values.description = StrUtil.toDBStr(info.eventDescription);
            values.halfWidthDescription = StrUtil.toHalf(values.description);
        }
        if (VideoFileAnalyzeModel.isEmpty(recorded.extended) === true && info.eventExtended !== null) {
            values.extended = StrUtil.toDBStr(info.eventExtended);
            values.halfWidthExtended = StrUtil.toHalf(values.extended);
        }

        // ジャンルは 3 組そろって初めて EPG 由来と同じ表示になる。1 つでも入っていれば触らない
        const hasGenre =
            typeof recorded.genre1 === 'number' ||
            typeof recorded.genre2 === 'number' ||
            typeof recorded.genre3 === 'number';
        if (hasGenre === false && info.genres.length > 0) {
            const genreKeys: Array<['genre1' | 'genre2' | 'genre3', 'subGenre1' | 'subGenre2' | 'subGenre3']> = [
                ['genre1', 'subGenre1'],
                ['genre2', 'subGenre2'],
                ['genre3', 'subGenre3'],
            ];
            genreKeys.forEach(([genreKey, subGenreKey], i) => {
                const genre = info.genres[i];
                if (typeof genre === 'undefined') return;
                values[genreKey] = genre.lv1;
                values[subGenreKey] = genre.lv2;
            });
        }

        if (VideoFileAnalyzeModel.isEmpty(recorded.videoType) === true && info.videoType !== null) {
            values.videoType = info.videoType;
        }
        if (VideoFileAnalyzeModel.isEmpty(recorded.videoResolution) === true && info.videoResolution !== null) {
            values.videoResolution = info.videoResolution;
        }
        if (typeof recorded.videoStreamContent !== 'number' && info.videoStreamContent !== null) {
            values.videoStreamContent = info.videoStreamContent;
        }
        if (typeof recorded.videoComponentType !== 'number' && info.videoComponentType !== null) {
            values.videoComponentType = info.videoComponentType;
        }
        if (typeof recorded.audioSamplingRate !== 'number' && info.audioSamplingRate !== null) {
            values.audioSamplingRate = info.audioSamplingRate;
        }
        if (typeof recorded.audioComponentType !== 'number' && info.audioComponentType !== null) {
            values.audioComponentType = info.audioComponentType;
        }

        if (Object.keys(values).length === 0) return false;

        await this.recordedDB.updateProgramInfo(recorded.id, values);
        this.log?.system.info(
            `apply program info from ts: recordedId ${recorded.id}: ${Object.keys(values).join(', ')}`,
        );

        return true;
    }

    /**
     * 値が未設定 (null / undefined / 空文字) か
     */
    private static isEmpty(value: string | null | undefined): boolean {
        return typeof value !== 'string' || value.length === 0;
    }

    /**
     * TS から分かった放送局を録画情報へ反映する。
     *
     * 取り込み時に放送局を特定できなかった録画は channel テーブルを引けず、
     * 画面に「不明な放送局」と出てしまう。TS の SDT には局名 (service_descriptor) が
     * 入っているため、次の順で補う
     * 1. network id + service id で channel を引けたら、その放送局へ紐付け直す (実況の解決も直る)
     * 2. 引けない場合は、表示名が空のときに限り SDT の局名を入れる
     *
     * すでに channel を引けている録画には触らない (正しく表示できているものを書き換えない)
     * @param videoFileId: apid.VideoFileId
     * @param info: TsInfo
     * @return Promise<void>
     */
    public async applyStoredChannelInfo(videoFileId: apid.VideoFileId): Promise<boolean> {
        const stored = await this.videoFileTsInfoDB.findId(videoFileId);
        if (stored === null) return false;

        return await this.applyChannelInfo(videoFileId, {
            networkId: stored.networkId ?? null,
            serviceId: stored.serviceId ?? null,
            serviceName: stored.serviceName ?? null,
        });
    }

    private async applyChannelInfo(videoFileId: apid.VideoFileId, info: ChannelSource): Promise<boolean> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) return false;

        const recorded = await this.recordedDB.findId(video.recordedId);
        if (recorded === null) return false;

        // 現在の channelId で放送局を引けているなら表示は壊れていないので何もしない
        const current = await this.channelDB.findId(recorded.channelId).catch(() => null);
        if (current !== null) return false;

        const channel =
            info.networkId === null || info.serviceId === null
                ? null
                : await this.channelDB.findNetworkIdAndServiceId(info.networkId, info.serviceId).catch(() => null);

        if (channel !== null) {
            await this.recordedDB.updateChannel(recorded.id, {
                channelId: channel.id,
                channelName: channel.name,
                halfWidthChannelName: channel.halfWidthName,
            });
            this.log?.system.info(
                `apply channel from ts: recordedId ${recorded.id}: ${recorded.channelId} -> ${channel.id} (${channel.name})`,
            );

            return true;
        }

        // channel テーブルに無い放送局 (受信できなくなった局・他地域の局など) は
        // 少なくとも局名だけでも出せるようにする
        if (info.serviceName === null || info.serviceName === '') return false;
        if (VideoFileAnalyzeModel.hasChannelName(recorded) === true) return false;

        await this.recordedDB.updateChannel(recorded.id, {
            channelName: info.serviceName,
            halfWidthChannelName: info.serviceName,
        });
        this.log?.system.info(`apply channel name from ts: recordedId ${recorded.id}: ${info.serviceName}`);

        return true;
    }

    /**
     * 録画情報に表示できる放送局名が入っているか
     */
    private static hasChannelName(recorded: {
        channelName?: string | null;
        halfWidthChannelName?: string | null;
    }): boolean {
        return (
            (typeof recorded.channelName === 'string' && recorded.channelName.length > 0) ||
            (typeof recorded.halfWidthChannelName === 'string' && recorded.halfWidthChannelName.length > 0)
        );
    }

    /**
     * DB のビデオファイル情報を API のメタデータ形式に変換する
     * @param video: VideoFile
     * @return apid.VideoFileMetadataResult
     */
    public toMetadataResult(video: VideoFile): apid.VideoFileMetadataResult {
        return {
            videoFileId: video.id,
            duration: video.duration ?? null,
            startTime: video.startTime ?? null,
            startAt: video.startAt === null || typeof video.startAt === 'undefined' ? null : Number(video.startAt),
            videoCodec: video.videoCodec ?? null,
            audioCodec: video.audioCodec ?? null,
            width: video.width ?? null,
            height: video.height ?? null,
            bitRate: video.bitRate ?? null,
            size: video.size,
        };
    }

    /**
     * 録画ファイル先頭 (再生位置 0 秒) に対応する実時刻を決める
     * TS の TDT / TOT が取れていればそれを使い、無ければファイルの更新時刻から推定する
     * @param video: VideoFile
     * @param filePath: string 実ファイルパス
     * @param duration: number 実測尺 (秒)
     * @return Promise<number | null> 決められなければ null
     */
    private async resolveStartAt(video: VideoFile, filePath: string, duration: number): Promise<number | null> {
        // TS 解析で得た放送時刻が最も正確
        const tsInfo = await this.videoFileTsInfoDB.findId(video.id).catch(() => null);
        if (tsInfo !== null && tsInfo.firstTdtAt !== null && typeof tsInfo.firstTdtAt !== 'undefined') {
            return Number(tsInfo.firstTdtAt);
        }

        const recorded = await this.recordedDB.findId(video.recordedId);

        // 録画中はファイル末尾が録画終了時刻にならないので推定しない
        if (recorded !== null && recorded.isRecording === true) {
            return null;
        }

        if (duration > 0) {
            try {
                const stats = await fs.stat(filePath);

                return Math.round(stats.mtimeMs - duration * 1000);
            } catch (err: any) {
                // stat に失敗した場合は番組開始時刻へフォールバックする
            }
        }

        return recorded === null ? null : Number(recorded.startAt);
    }

    /**
     * 解析結果を DB エンティティへ変換する
     */
    private static toEntity(videoFileId: apid.VideoFileId, info: TsInfo): VideoFileTsInfo {
        const entity = new VideoFileTsInfo();
        entity.videoFileId = videoFileId;
        entity.networkId = info.networkId;
        entity.transportStreamId = info.transportStreamId;
        entity.serviceId = info.serviceId;
        entity.serviceType = info.serviceType;
        entity.serviceName = info.serviceName;
        entity.serviceProviderName = info.serviceProviderName;
        entity.networkName = info.networkName;
        entity.eventId = info.eventId;
        entity.eventName = info.eventName;
        entity.eventDescription = info.eventDescription;
        entity.eventExtended = info.eventExtended;
        entity.eventStartAt = info.eventStartAt;
        entity.eventDuration = info.eventDuration;
        entity.genre1 = info.genres[0]?.lv1 ?? null;
        entity.subGenre1 = info.genres[0]?.lv2 ?? null;
        entity.genre2 = info.genres[1]?.lv1 ?? null;
        entity.subGenre2 = info.genres[1]?.lv2 ?? null;
        entity.genre3 = info.genres[2]?.lv1 ?? null;
        entity.subGenre3 = info.genres[2]?.lv2 ?? null;
        entity.videoStreamType = info.videoStreamType;
        entity.videoPid = info.videoPid;
        entity.audioStreamType = info.audioStreamType;
        entity.audioPid = info.audioPid;
        entity.firstTdtAt = info.firstTdtAt;
        entity.analyzedAt = new Date().getTime();

        return entity;
    }
}
