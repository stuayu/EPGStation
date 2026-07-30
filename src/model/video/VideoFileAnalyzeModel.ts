import { promises as fs } from 'fs';
import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import VideoFile from '../../db/entities/VideoFile';
import VideoFileTsInfo from '../../db/entities/VideoFileTsInfo';
import IVideoUtil from '../api/video/IVideoUtil';
import IRecordedDB from '../db/IRecordedDB';
import IVideoFileDB from '../db/IVideoFileDB';
import IVideoFileTsInfoDB from '../db/IVideoFileTsInfoDB';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import ITsInfoAnalyzer, { TsInfo } from '../recorded/ts/ITsInfoAnalyzer';
import IVideoFileAnalyzeModel from './IVideoFileAnalyzeModel';

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
    // TS 解析の対象にするファイル種別 (エンコード済みファイルには PSI/SI が無い)
    private static readonly TS_FILE_TYPE = 'ts';

    private videoFileDB: IVideoFileDB;
    private videoFileTsInfoDB: IVideoFileTsInfoDB;
    private recordedDB: IRecordedDB;
    private videoUtil: IVideoUtil;
    private tsInfoAnalyzer: ITsInfoAnalyzer;
    private log: ILogger | null;

    constructor(
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IVideoFileTsInfoDB') videoFileTsInfoDB: IVideoFileTsInfoDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
        @inject('ITsInfoAnalyzer') tsInfoAnalyzer: ITsInfoAnalyzer,
        @inject('ILoggerModel') logger?: ILoggerModel,
    ) {
        this.videoFileDB = videoFileDB;
        this.videoFileTsInfoDB = videoFileTsInfoDB;
        this.recordedDB = recordedDB;
        this.videoUtil = videoUtil;
        this.tsInfoAnalyzer = tsInfoAnalyzer;
        this.log = typeof logger === 'undefined' ? null : logger.getLogger();
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
     * @param videoFileId: apid.VideoFileId
     * @return Promise<boolean> 解析して保存した場合 true (TS ファイルでない場合は false)
     */
    public async analyzeTsInfo(videoFileId: apid.VideoFileId): Promise<boolean> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) {
            throw new Error('VideoFileIsUndefined');
        }

        // エンコード済みファイルには PSI/SI が無い
        if (video.type !== VideoFileAnalyzeModel.TS_FILE_TYPE) {
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

        // TDT / TOT から録画開始時刻が分かった場合は、推定値より優先して記録する
        if (info.firstTdtAt !== null) {
            await this.videoFileDB.updateStartAt(videoFileId, info.firstTdtAt);
        }
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
