import * as apid from '../../../api';
import VideoFile from '../../db/entities/VideoFile';
import VideoFileTsInfo from '../../db/entities/VideoFileTsInfo';

export default interface IVideoFileTsInfoDB {
    upsert(info: VideoFileTsInfo): Promise<void>;
    findId(videoFileId: apid.VideoFileId): Promise<VideoFileTsInfo | null>;
    findRecordedId(recordedId: apid.RecordedId): Promise<VideoFileTsInfo | null>;
    findWithoutTsInfo(limit: number, offset?: number): Promise<VideoFile[]>;
    findAnalyzedVideoFileIds(limit: number, offset: number): Promise<apid.VideoFileId[]>;
    countAnalyzed(): Promise<number>;
    countWithoutTsInfo(): Promise<number>;
    countAnalyzableVideoFiles(): Promise<number>;
    findAllAnalyzable(limit: number, offset: number): Promise<VideoFile[]>;
    deleteVideoFileId(videoFileId: apid.VideoFileId): Promise<void>;
}
