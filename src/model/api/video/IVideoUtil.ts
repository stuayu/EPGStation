import * as apid from '../../../../api';
import VideoFile from '../../../db/entities/VideoFile';
export interface VideoInfo {
    duration: number; // sec
    size: number; // byte
    bitRate: number; // bps
}

/**
 * ffprobe で実測した動画メタデータ
 * 取得できなかった項目は null になる
 */
export interface VideoDetailInfo extends VideoInfo {
    startTime: number | null; // コンテナの開始オフセット (秒)
    videoCodec: string | null;
    audioCodec: string | null;
    width: number | null;
    height: number | null;
    pixFmt?: string | null;
    profile?: string | null;
    fieldOrder?: string | null;
    avgFrameRate?: string | null;
    rFrameRate?: string | null;
    colorPrimaries?: string | null;
    colorTransfer?: string | null;
    colorSpace?: string | null;
    bitsPerRawSample?: string | number | null;
}

export default interface IVideoUtil {
    getFullFilePathFromId(videoFileId: apid.VideoFileId): Promise<string | null>;
    getFullFilePathFromVideoFile(videoFile: VideoFile): string | null;
    getParentDirPath(name: string): string | null;
    getInfo(filePath: string): Promise<VideoInfo>;
    getDetailedInfo(filePath: string): Promise<VideoDetailInfo>;

    /**
     * チャプターを取得する。
     * ffprobe でファイルに埋め込まれたチャプターを読み、無ければ
     * 動画の横に置かれた `<動画ファイル名>.chapter.txt` を読む
     * (MPEG-TS はチャプターを埋め込めないため、tsreplace 出力などはこちらになる)
     * @param filePath: string
     * @return Promise<apid.VideoChapter[]> チャプターが無い場合は空配列
     */
    getChapters(filePath: string): Promise<apid.VideoChapter[]>;

    /**
     * ffprobe で音声トラック一覧を取得する
     * デュアルモノラルの ES は主音声・副音声の 2 件へ展開される
     * @param filePath: string
     * @return Promise<apid.VideoAudioTrack[]>
     */
    getAudioTracks(filePath: string): Promise<apid.VideoAudioTrack[]>;
}
