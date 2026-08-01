import * as apid from '../../../api';
import VideoFile from '../../db/entities/VideoFile';

export interface UpdateFilePathOption {
    videoFileId: apid.VideoFileId;
    parentDirectoryName: string;
    filePath: string;
}

/**
 * ffprobe で実測した動画メタデータの更新値
 */
export interface VideoFileMetadata {
    duration: number | null;
    startTime: number | null;
    videoCodec: string | null;
    audioCodec: string | null;
    width: number | null;
    height: number | null;
    bitRate: number | null;
    size?: number;
}

export default interface IVideoFileDB {
    restore(items: VideoFile[]): Promise<void>;
    insertOnce(videoFile: VideoFile): Promise<apid.VideoFileId>;
    updateFilePath(option: UpdateFilePathOption): Promise<void>;
    updateSize(videoFileId: apid.VideoFileId, size: number): Promise<void>;
    deleteOnce(VideoFileId: apid.VideoFileId): Promise<void>;
    deleteRecordedId(recordedId: apid.RecordedId): Promise<void>;
    updateMetadata(videoFileId: apid.VideoFileId, metadata: VideoFileMetadata): Promise<void>;
    updateStartAt(videoFileId: apid.VideoFileId, startAt: number): Promise<void>;
    findId(videoFileId: apid.VideoFileId): Promise<VideoFile | null>;
    findAll(): Promise<VideoFile[]>;
    findWithoutMetadata(limit: number, offset?: number): Promise<VideoFile[]>;
    findAllPaged(limit: number, offset: number): Promise<VideoFile[]>;
    findRecordedId(recordedId: apid.RecordedId): Promise<VideoFile[]>;
    countWithoutMetadata(): Promise<number>;
    countAll(): Promise<number>;
}
