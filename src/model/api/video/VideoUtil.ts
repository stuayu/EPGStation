import { execFile } from 'child_process';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import VideoFile from '../../../db/entities/VideoFile';
import IVideoFileDB from '../../db/IVideoFileDB';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import IVideoUtil, { VideoDetailInfo, VideoInfo } from './IVideoUtil';

@injectable()
export default class VideoUtil implements IVideoUtil {
    // ffprobe の出力 (ストリーム情報込み) を受け取るバッファサイズ
    private static readonly FFPROBE_MAX_BUFFER = 10 * 1024 * 1024;

    private config: IConfigFile;
    private videoFileDB: IVideoFileDB;

    constructor(
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
    ) {
        this.config = configuration.getConfig();
        this.videoFileDB = videoFileDB;
    }

    public async getFullFilePathFromId(videoFileId: apid.VideoFileId): Promise<string | null> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) {
            return null;
        }

        const parentDir = this.getParentDirPath(video.parentDirectoryName);

        return parentDir === null ? null : path.join(parentDir, video.filePath);
    }

    public getFullFilePathFromVideoFile(videoFile: VideoFile): string | null {
        const parentDir = this.getParentDirPath(videoFile.parentDirectoryName);

        return parentDir === null ? null : path.join(parentDir, videoFile.filePath);
    }

    public getParentDirPath(name: string): string | null {
        if (name === 'tmp' && typeof this.config.recordedTmp !== 'undefined') {
            return this.config.recordedTmp;
        }

        for (const r of this.config.recorded) {
            if (r.name === name) {
                return r.path;
            }
        }

        // register モードで取り込んだ外部ファイルの実体は importDirs 配下にある
        if (typeof this.config.importDirs !== 'undefined') {
            for (const d of this.config.importDirs) {
                if (d.name === name) {
                    return d.path;
                }
            }
        }

        return null;
    }

    /**
     * ffprobe で動画の詳細メタデータ (尺・開始オフセット・コーデック・解像度・ビットレート) を取得する
     * @param filePath: string 解析対象のファイルパス
     * @return Promise<VideoDetailInfo>
     */
    public getDetailedInfo(filePath: string): Promise<VideoDetailInfo> {
        return new Promise<VideoDetailInfo>((resolve, reject) => {
            execFile(
                this.config.ffprobe,
                ['-v', '0', '-show_format', '-show_streams', '-of', 'json', filePath],
                { maxBuffer: VideoUtil.FFPROBE_MAX_BUFFER },
                (err, stdout) => {
                    if (err) {
                        reject(err);

                        return;
                    }

                    try {
                        const result = <any>JSON.parse(stdout);
                        const streams: any[] = Array.isArray(result.streams) ? result.streams : [];
                        const video = streams.find(s => s.codec_type === 'video');
                        const audio = streams.find(s => s.codec_type === 'audio');

                        resolve({
                            duration: VideoUtil.toNumber(result.format?.duration) ?? 0,
                            size: VideoUtil.toNumber(result.format?.size) ?? 0,
                            bitRate: VideoUtil.toNumber(result.format?.bit_rate) ?? 0,
                            startTime: VideoUtil.toNumber(result.format?.start_time),
                            videoCodec: typeof video?.codec_name === 'string' ? video.codec_name : null,
                            audioCodec: typeof audio?.codec_name === 'string' ? audio.codec_name : null,
                            width: VideoUtil.toNumber(video?.width),
                            height: VideoUtil.toNumber(video?.height),
                        });
                    } catch (e: any) {
                        reject(e);
                    }
                },
            );
        });
    }

    /**
     * ffprobe の出力を数値に変換する
     * @param value: unknown ffprobe の出力値
     * @return number | null 数値として扱えない場合は null
     */
    private static toNumber(value: unknown): number | null {
        if (typeof value === 'number') {
            return isNaN(value) === true ? null : value;
        }

        if (typeof value !== 'string' || value.length === 0 || value === 'N/A') {
            return null;
        }

        const parsed = parseFloat(value);

        return isNaN(parsed) === true ? null : parsed;
    }

    public getInfo(filePath: string): Promise<VideoInfo> {
        return new Promise<VideoInfo>((resolve, reject) => {
            execFile(this.config.ffprobe, ['-v', '0', '-show_format', '-of', 'json', filePath], (err, stdout) => {
                if (err) {
                    reject(err);

                    return;
                }

                try {
                    const result = <any>JSON.parse(stdout);
                    resolve({
                        duration: parseFloat(result.format.duration),
                        size: parseInt(result.format.size, 10),
                        bitRate: parseFloat(result.format.bit_rate),
                    });
                } catch (err: any) {
                    reject(err);
                }
            });
        });
    }
}
