import * as apid from '../../../../../api';

export default interface IVideoApiModel {
    delete(videoFileId: apid.VideoFileId): Promise<void>;
    getDuration(videoFileId: apid.VideoFileId): Promise<number>;
    getMetadata(videoFileId: apid.VideoFileId): Promise<apid.VideoFileMetadataResult>;
    analyzeMetadata(videoFileId: apid.VideoFileId): Promise<apid.VideoFileMetadataResult>;
    getMetadataStatus(): Promise<apid.VideoFileMetadataStatus>;
    analyzeAllMetadata(option?: apid.AnalyzeVideoFilesOption): Promise<apid.AnalyzeVideoFilesResult>;
    getPlaybackPosition(videoFileId: apid.VideoFileId): Promise<apid.WatchHistory | null>;
    savePlaybackPosition(videoFileId: apid.VideoFileId, option: apid.UpdatePlaybackPositionOption): Promise<apid.WatchHistory>;
    savePlaybackPositionWithBeacon(videoFileId: apid.VideoFileId, option: apid.UpdatePlaybackPositionOption): void;
    sendToKodi(hostName: string, videoFileId: apid.VideoFileId): Promise<void>;
    uploadedVideoFile(option: apid.UploadVideoFileOption): Promise<void>;
}
