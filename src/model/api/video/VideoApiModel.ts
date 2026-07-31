import { fileTypeFromFile } from 'file-type';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import IRecordedDB from '../../db/IRecordedDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IVideoFileTsInfoDB from '../../db/IVideoFileTsInfoDB';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IIPCClient from '../../ipc/IIPCClient';
import IApiUtil from '../IApiUtil';
import IPlayList from '../IPlayList';
import IVideoFileAnalyzeModel from '../../video/IVideoFileAnalyzeModel';
import IVideoApiModel, {
    AnalyzeVideoFilesResult,
    ReanalyzeTsInfoResult,
    VideoFileMetadataResult,
    VideoFileMetadataStatus,
    VideoFilePathInfo,
} from './IVideoApiModel';
import IVideoUtil from './IVideoUtil';

@injectable()
export default class VideoApiModel implements IVideoApiModel {
    // 一括解析の既定件数 / 上限件数
    private static readonly ANALYZE_DEFAULT_LIMIT = 100;
    private static readonly ANALYZE_MAX_LIMIT = 1000;
    // 一括解析で失敗理由をログに残す件数 (16000 件規模でログを埋めないため)
    private static readonly ANALYZE_LOG_LIMIT = 3;

    private configuration: IConfiguration;
    private videoFileDB: IVideoFileDB;
    private videoFileTsInfoDB: IVideoFileTsInfoDB;
    private recordedDB: IRecordedDB;
    private apiUtil: IApiUtil;
    private videoUtil: IVideoUtil;
    private ipc: IIPCClient;
    private analyzeModel: IVideoFileAnalyzeModel;
    private log: ILogger | null;

    constructor(
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IVideoFileTsInfoDB') videoFileTsInfoDB: IVideoFileTsInfoDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IApiUtil') apiUtil: IApiUtil,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
        @inject('IIPCClient') ipc: IIPCClient,
        @inject('IVideoFileAnalyzeModel') analyzeModel: IVideoFileAnalyzeModel,
        @inject('ILoggerModel') logger?: ILoggerModel,
    ) {
        this.configuration = configuration;
        this.videoFileDB = videoFileDB;
        this.videoFileTsInfoDB = videoFileTsInfoDB;
        this.recordedDB = recordedDB;
        this.apiUtil = apiUtil;
        this.videoUtil = videoUtil;
        this.ipc = ipc;
        this.analyzeModel = analyzeModel;
        this.log = typeof logger === 'undefined' ? null : logger.getLogger();
    }

    /**
     * 指定した video fie id のファイルパスを返す
     * @param videoFileId: apid.VideoFileId
     * @return Promise<VideoFilePathInfo | null>
     */
    public async getFullFilePath(videoFileId: apid.VideoFileId): Promise<VideoFilePathInfo | null> {
        const fullPath = await this.videoUtil.getFullFilePathFromId(videoFileId);

        return fullPath === null
            ? null
            : {
                  path: fullPath,
                  mime: await this.createMime(fullPath),
              };
    }

    /**
     * 指定されたファイルパスからファイルの mime を返す
     * @param filePath: string ファイルパス
     * @return Promise<string>
     */
    private async createMime(filePath: string): Promise<string> {
        const mime = await fileTypeFromFile(filePath);
        if (typeof mime !== 'undefined') {
            return mime.mime;
        }

        switch (path.extname(filePath)) {
            case '.m2ts':
            case '.ts':
                return 'video/mp2t';
            default:
                throw new Error('MimeTypeError');
        }
    }

    /**
     * 指定した videoFileId の m3u8 形式プレイリスト文字列を取得する
     * @param host: string host
     * @param isSecure: boolean https 通信か
     * @param videoFileId: apid.VideoFileId
     * @return Promise<IPlayList | null>
     */
    public async getM3u8(host: string, isSecure: boolean, videoFileId: apid.VideoFileId): Promise<IPlayList | null> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null || typeof video.recordedId === 'undefined') {
            return null;
        }

        const recorded = await this.recordedDB.findId(video?.recordedId);
        if (recorded === null) {
            return null;
        }

        return {
            name: encodeURIComponent(path.basename(video.filePath) + '.m3u8'),
            playList: this.apiUtil.createM3U8PlayListStr({
                host: host,
                isSecure: isSecure,
                name: recorded.name,
                duration: Math.floor(recorded.duration / 1000),
                baseUrl: `/api/videos/${videoFileId}`,
            }),
        };
    }

    /**
     * 指定した video file id のファイルを削除
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async deleteVideoFile(videoFileId: apid.VideoFileId): Promise<void> {
        await this.ipc.recorded.deleteVideoFile(videoFileId);
    }

    /**
     * 指定した video file id のファイルの動画長を取得する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<number> 秒
     */
    public async getDuration(videoFileId: apid.VideoFileId): Promise<number> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) {
            throw new Error('VideoFileIsUndefined');
        }

        // 解析済みなら DB の実測値を使う (ffprobe を毎回走らせない)
        if (video.analyzedAt !== null && typeof video.duration === 'number' && video.duration > 0) {
            return video.duration;
        }

        const metadata = await this.analyzeMetadata(videoFileId);

        return metadata.duration === null ? 0 : metadata.duration;
    }

    /**
     * 指定した video file id のメタデータを返す。未解析ならその場で解析する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<VideoFileMetadataResult>
     */
    public async getMetadata(videoFileId: apid.VideoFileId): Promise<VideoFileMetadataResult> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) {
            throw new Error('VideoFileIsUndefined');
        }

        return video.analyzedAt === null
            ? await this.analyzeMetadata(videoFileId)
            : this.analyzeModel.toMetadataResult(video);
    }

    /**
     * 指定した video file id の実ファイルを ffprobe で解析して DB に保存する
     * 実処理は Operator (取り込み時) と共通の VideoFileAnalyzeModel に委譲する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<VideoFileMetadataResult>
     */
    public async analyzeMetadata(videoFileId: apid.VideoFileId): Promise<VideoFileMetadataResult> {
        return await this.analyzeModel.analyzeMetadata(videoFileId);
    }

    /**
     * 未解析の録画ファイルをまとめて解析する
     * @param limit: number | undefined 一度に解析する上限件数
     * @return Promise<AnalyzeVideoFilesResult>
     */
    public async analyzeAllMetadata(limit?: number): Promise<AnalyzeVideoFilesResult> {
        const max = Math.min(
            typeof limit === 'number' && limit > 0 ? Math.floor(limit) : VideoApiModel.ANALYZE_DEFAULT_LIMIT,
            VideoApiModel.ANALYZE_MAX_LIMIT,
        );

        const targets = await this.videoFileDB.findWithoutMetadata(max);

        let analyzed = 0;
        let failed = 0;
        for (const target of targets) {
            try {
                await this.analyzeMetadata(target.id);
                analyzed++;
            } catch (err: any) {
                // 1 件失敗しても残りは続行する (ファイル欠損・壊れた TS など)
                // 全件失敗する設定不備 (ffprobe のパス誤り・録画ディレクトリ名の不一致) に気付けるよう
                // 先頭数件だけ理由を残す
                failed++;
                if (failed <= VideoApiModel.ANALYZE_LOG_LIMIT) {
                    this.log?.system.warn(
                        `video file metadata analysis failed: videoFileId ${target.id}: ${err?.message ?? err}`,
                    );
                }
            }
        }

        return {
            analyzed: analyzed,
            failed: failed,
            remaining: await this.videoFileDB.countWithoutMetadata(),
        };
    }

    /**
     * TS (PSI/SI) の解析状況を返す
     * エンコード済みファイルには PSI/SI が無いため、TS ファイルのみを母数にする
     * @return Promise<VideoFileMetadataStatus>
     */
    public async getTsInfoStatus(): Promise<VideoFileMetadataStatus> {
        const total = await this.videoFileTsInfoDB.countAnalyzableVideoFiles();
        const unanalyzed = await this.videoFileTsInfoDB.countWithoutTsInfo();

        return {
            total: total,
            analyzed: total - unanalyzed,
            unanalyzed: unanalyzed,
        };
    }

    /**
     * まだ TS 解析していない録画ファイルをまとめて解析する
     * @param limit: number | undefined 一度に解析する上限件数
     * @return Promise<AnalyzeVideoFilesResult>
     */
    public async analyzeAllTsInfo(limit?: number): Promise<AnalyzeVideoFilesResult> {
        const max = Math.min(
            typeof limit === 'number' && limit > 0 ? Math.floor(limit) : VideoApiModel.ANALYZE_DEFAULT_LIMIT,
            VideoApiModel.ANALYZE_MAX_LIMIT,
        );

        const targets = await this.videoFileTsInfoDB.findWithoutTsInfo(max);

        let analyzed = 0;
        let failed = 0;
        for (const target of targets) {
            try {
                await this.analyzeModel.analyzeTsInfo(target.id);
                analyzed++;
            } catch (err: any) {
                // 1 件失敗しても残りは続行する (ファイル欠損・壊れた TS など)
                failed++;
                if (failed <= VideoApiModel.ANALYZE_LOG_LIMIT) {
                    this.log?.system.warn(`ts info analysis failed: videoFileId ${target.id}: ${err?.message ?? err}`);
                }
            }
        }

        return {
            analyzed: analyzed,
            failed: failed,
            remaining: await this.videoFileTsInfoDB.countWithoutTsInfo(),
        };
    }

    /**
     * TS ファイルを、解析済みかどうかに関わらず offset から順に強制的に再解析する。
     * 解析ロジック (例: PCR による録画開始時刻の補正) を更新した後、既存ファイルへ
     * 反映させたい場合に使う。呼び出し側は nextOffset が null になるまで呼び続ける
     * @param offset: number | undefined 開始位置 (省略時 0)
     * @param limit: number | undefined 一度に解析する上限件数
     * @return Promise<ReanalyzeTsInfoResult>
     */
    public async reanalyzeAllTsInfo(offset?: number, limit?: number): Promise<ReanalyzeTsInfoResult> {
        const max = Math.min(
            typeof limit === 'number' && limit > 0 ? Math.floor(limit) : VideoApiModel.ANALYZE_DEFAULT_LIMIT,
            VideoApiModel.ANALYZE_MAX_LIMIT,
        );
        const start = typeof offset === 'number' && offset > 0 ? Math.floor(offset) : 0;

        const targets = await this.videoFileTsInfoDB.findAllAnalyzable(max, start);

        let analyzed = 0;
        let failed = 0;
        for (const target of targets) {
            try {
                await this.analyzeModel.analyzeTsInfo(target.id);
                analyzed++;
            } catch (err: any) {
                // 1 件失敗しても残りは続行する (ファイル欠損・壊れた TS など)
                failed++;
                if (failed <= VideoApiModel.ANALYZE_LOG_LIMIT) {
                    this.log?.system.warn(
                        `ts info reanalysis failed: videoFileId ${target.id}: ${err?.message ?? err}`,
                    );
                }
            }
        }

        const total = await this.videoFileTsInfoDB.countAnalyzableVideoFiles();
        const nextOffset = start + targets.length;

        return {
            analyzed: analyzed,
            failed: failed,
            nextOffset: targets.length < max || nextOffset >= total ? null : nextOffset,
            total: total,
        };
    }

    /**
     * 録画ファイルのメタデータ解析状況を返す
     * @return Promise<VideoFileMetadataStatus>
     */
    public async getMetadataStatus(): Promise<VideoFileMetadataStatus> {
        const total = await this.videoFileDB.countAll();
        const unanalyzed = await this.videoFileDB.countWithoutMetadata();

        return {
            total: total,
            analyzed: total - unanalyzed,
            unanalyzed: unanalyzed,
        };
    }

    public async sendToKodi(
        host: string,
        isSecure: boolean,
        kodiName: string,
        videoFileId: apid.VideoFileId,
    ): Promise<void> {
        host = this.apiUtil.getHost(host);

        // kodiName で指定された kodi host を config から探す
        const config = this.configuration.getConfig();
        if (typeof config.kodiHosts === 'undefined') {
            throw new Error('KodiHostsIsUndefined');
        }
        const kodi = config.kodiHosts.find(k => {
            return k.name === kodiName;
        });
        if (typeof kodi === 'undefined') {
            throw new Error('KodiHostIsUndefined');
        }

        const videoFile = await this.videoFileDB.findId(videoFileId);
        if (videoFile === null) {
            throw new Error('VideoFileIsUndefined');
        }

        const source = `${isSecure ? 'https' : 'http'}://${host}/api/videos/${videoFileId}`;

        return this.apiUtil.sendToKodi(source, kodi);
    }
}
