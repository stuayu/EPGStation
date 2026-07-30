import * as apid from '../../../api';
import VideoFile from '../../db/entities/VideoFile';
import { TsInfo } from '../recorded/ts/ITsInfoAnalyzer';

export default interface IVideoFileAnalyzeModel {
    analyzeMetadata(videoFileId: apid.VideoFileId): Promise<apid.VideoFileMetadataResult>;
    analyzeTsInfo(videoFileId: apid.VideoFileId): Promise<boolean>;
    saveTsInfo(videoFileId: apid.VideoFileId, info: TsInfo): Promise<void>;
    analyzeAll(videoFileId: apid.VideoFileId): Promise<void>;
    toMetadataResult(video: VideoFile): apid.VideoFileMetadataResult;
}
