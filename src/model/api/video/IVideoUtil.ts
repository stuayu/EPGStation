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
}

export default interface IVideoUtil {
    getFullFilePathFromId(videoFileId: apid.VideoFileId): Promise<string | null>;
    getFullFilePathFromVideoFile(videoFile: VideoFile): string | null;
    getParentDirPath(name: string): string | null;
    getInfo(filePath: string): Promise<VideoInfo>;
    getDetailedInfo(filePath: string): Promise<VideoDetailInfo>;
}
