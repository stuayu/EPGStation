import { execFile } from 'child_process';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import VideoFile from '../../../db/entities/VideoFile';
import ChapterFileUtil from '../../../util/ChapterFileUtil';
import FileUtil from '../../../util/FileUtil';
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

    public async getChapters(filePath: string): Promise<apid.VideoChapter[]> {
        const probed = await this.getEmbeddedChapters(filePath);
        if (probed.chapters.length > 0) {
            return probed.chapters;
        }

        // MPEG-TS はチャプターを埋め込めないため、tsreplace 出力 (.ts のまま) などでは
        // 動画の横に置かれた `<動画ファイル名>.chapter.txt` を読む
        return await this.getSidecarChapters(filePath, probed.duration);
    }

    /**
     * ffprobe でファイルに埋め込まれたチャプターと動画全体の長さを取得する
     * @param filePath: string
     * @return Promise<{ chapters: apid.VideoChapter[]; duration?: number }>
     */
    private getEmbeddedChapters(filePath: string): Promise<{ chapters: apid.VideoChapter[]; duration?: number }> {
        return new Promise<{ chapters: apid.VideoChapter[]; duration?: number }>((resolve, reject) => {
            execFile(
                this.config.ffprobe,
                ['-v', '0', '-show_chapters', '-show_format', '-of', 'json', filePath],
                { maxBuffer: VideoUtil.FFPROBE_MAX_BUFFER },
                (err, stdout) => {
                    if (err) {
                        reject(err);

                        return;
                    }

                    try {
                        const result = <any>JSON.parse(stdout);
                        const chapters: any[] = Array.isArray(result.chapters) ? result.chapters : [];
                        const duration = VideoUtil.toNumber(result.format?.duration);

                        resolve({
                            chapters: chapters.map((chapter, index) => {
                                // start_time / end_time は秒の文字列。無い場合は time_base × start から計算する
                                const timeBase = VideoUtil.parseTimeBase(chapter.time_base);
                                const startAt =
                                    VideoUtil.toNumber(chapter.start_time) ??
                                    (VideoUtil.toNumber(chapter.start) ?? 0) * timeBase;
                                const endAt =
                                    VideoUtil.toNumber(chapter.end_time) ??
                                    (VideoUtil.toNumber(chapter.end) ?? 0) * timeBase;
                                const title = chapter.tags?.title;

                                return {
                                    id: typeof chapter.id === 'number' ? chapter.id : index,
                                    startAt: startAt,
                                    endAt: endAt,
                                    title: typeof title === 'string' && title.length > 0 ? title : null,
                                };
                            }),
                            duration: duration === null ? undefined : duration,
                        });
                    } catch (e: any) {
                        reject(e);
                    }
                },
            );
        });
    }

    /**
     * 動画ファイルの横に置かれたチャプターファイルを読む
     * @param filePath: string 動画ファイルのパス
     * @param duration?: number 動画全体の長さ (秒)。最後のチャプターの終了位置に使う
     * @return Promise<apid.VideoChapter[]> ファイルが無い・読めない場合は空配列
     */
    private async getSidecarChapters(filePath: string, duration?: number): Promise<apid.VideoChapter[]> {
        const chapterFilePath = ChapterFileUtil.getChapterFilePath(filePath);

        try {
            const content = await FileUtil.readFile(chapterFilePath);

            return ChapterFileUtil.parse(content, duration);
        } catch (err: any) {
            // チャプターファイルが無いのは普通の状態なのでログには残さない
            return [];
        }
    }

    public getAudioTracks(filePath: string): Promise<apid.VideoAudioTrack[]> {
        return new Promise<apid.VideoAudioTrack[]>((resolve, reject) => {
            execFile(
                this.config.ffprobe,
                ['-v', '0', '-show_streams', '-select_streams', 'a', '-of', 'json', filePath],
                { maxBuffer: VideoUtil.FFPROBE_MAX_BUFFER },
                (err, stdout) => {
                    if (err) {
                        reject(err);

                        return;
                    }

                    try {
                        const result = <any>JSON.parse(stdout);
                        const streams: any[] = Array.isArray(result.streams) ? result.streams : [];

                        resolve(VideoUtil.buildAudioTracks(streams));
                    } catch (e: any) {
                        reject(e);
                    }
                },
            );
        });
    }

    /**
     * ffprobe の音声ストリーム情報から音声トラック一覧を組み立てる
     *
     * 地上波・BS/CS の二か国語放送は「1 つのステレオ ES の左右に主音声・副音声」を入れる
     * デュアルモノラルで送られる。ffprobe からは 2ch のステレオにしか見えないため、
     * **音声 ES が 1 つだけで 2ch のときは主音声・副音声の 2 トラックへ展開する**
     * (実際にはただのステレオ放送であることも多いので、名前は「主音声」「副音声(デュアルモノラル時)」とする)。
     * 音声 ES が複数ある場合はそれぞれが独立した音声なので展開しない
     * @param streams: any[] ffprobe の音声ストリーム情報
     * @return apid.VideoAudioTrack[]
     */
    private static buildAudioTracks(streams: any[]): apid.VideoAudioTrack[] {
        const tracks: apid.VideoAudioTrack[] = [];

        for (let i = 0; i < streams.length; i++) {
            const stream = streams[i];
            const codec = typeof stream.codec_name === 'string' ? stream.codec_name : null;
            const language = typeof stream.tags?.language === 'string' ? stream.tags.language : null;
            const channels = VideoUtil.toNumber(stream.channels);
            const title = typeof stream.tags?.title === 'string' ? stream.tags.title : null;

            const base = {
                streamIndex: i,
                codec: codec,
                language: language,
                channels: channels,
            };

            if (streams.length === 1 && channels === 2) {
                tracks.push({
                    ...base,
                    track: 'main',
                    name: title ?? '主音声',
                    isDualMono: true,
                });
                tracks.push({
                    ...base,
                    track: 'sub',
                    name: '副音声 (デュアルモノラル)',
                    isDualMono: true,
                });

                continue;
            }

            tracks.push({
                ...base,
                track: i.toString(10),
                name: title ?? (i === 0 ? '主音声' : `音声 ${i + 1}`),
                isDualMono: false,
            });
        }

        return tracks;
    }

    /**
     * ffprobe の time_base ("1/1000" 形式) を秒へ換算する係数として解釈する
     * @param value: unknown
     * @return number 解釈できない場合は 0 (start_time 側が使われる想定)
     */
    private static parseTimeBase(value: unknown): number {
        if (typeof value !== 'string') {
            return 0;
        }

        const parts = value.split('/');
        if (parts.length !== 2) {
            return 0;
        }

        const numerator = parseFloat(parts[0]);
        const denominator = parseFloat(parts[1]);

        return isNaN(numerator) === true || isNaN(denominator) === true || denominator === 0
            ? 0
            : numerator / denominator;
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
