import * as apid from '../../../../api';
import IPlayList from '../IPlayList';

export interface VideoFilePathInfo {
    path: string;
    mime: string;
}

export type VideoFileMetadataResult = apid.VideoFileMetadataResult;
export type VideoFileMetadataStatus = apid.VideoFileMetadataStatus;
export type AnalyzeVideoFilesResult = apid.AnalyzeVideoFilesResult;
export type ReanalyzeTsInfoResult = apid.ReanalyzeTsInfoResult;

export default interface IVideoApiModel {
    getFullFilePath(videoFileId: apid.VideoFileId): Promise<VideoFilePathInfo | null>;
    getM3u8(host: string, isSecure: boolean, videoFileId: apid.VideoFileId): Promise<IPlayList | null>;
    deleteVideoFile(videoFileId: apid.VideoFileId): Promise<void>;
    getDuration(videoFileId: apid.VideoFileId): Promise<number>;
    getMetadata(videoFileId: apid.VideoFileId): Promise<VideoFileMetadataResult>;
    analyzeMetadata(videoFileId: apid.VideoFileId): Promise<VideoFileMetadataResult>;
    analyzeAllMetadata(limit?: number): Promise<AnalyzeVideoFilesResult>;
    getMetadataStatus(): Promise<VideoFileMetadataStatus>;
    getTsInfoStatus(): Promise<VideoFileMetadataStatus>;
    analyzeAllTsInfo(limit?: number): Promise<AnalyzeVideoFilesResult>;
    reanalyzeAllTsInfo(offset?: number, limit?: number): Promise<ReanalyzeTsInfoResult>;
    sendToKodi(host: string, isSecure: boolean, kodiName: string, videoFileId: apid.VideoFileId): Promise<void>;
}
