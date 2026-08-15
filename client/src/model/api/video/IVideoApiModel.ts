import * as apid from '../../../../../api';

export default interface IVideoApiModel {
    delete(videoFileId: apid.VideoFileId): Promise<void>;
    getDuration(videoFileId: apid.VideoFileId): Promise<number>;
    getMetadata(videoFileId: apid.VideoFileId): Promise<apid.VideoFileMetadataResult>;
    analyzeMetadata(videoFileId: apid.VideoFileId): Promise<apid.VideoFileMetadataResult>;
    getMetadataStatus(): Promise<apid.VideoFileMetadataStatus>;
    analyzeAllMetadata(option?: apid.AnalyzeVideoFilesOption): Promise<apid.AnalyzeVideoFilesResult>;
    getTsInfoStatus(): Promise<apid.VideoFileMetadataStatus>;
    analyzeAllTsInfo(option?: apid.AnalyzeVideoFilesOption): Promise<apid.AnalyzeVideoFilesResult>;
    reanalyzeAllTsInfo(option?: apid.ReanalyzeTsInfoOption): Promise<apid.ReanalyzeTsInfoResult>;
    getAnalyzeJob(): Promise<apid.VideoAnalyzeJob>;
    startAnalyzeJob(option: apid.StartVideoAnalyzeJobOption): Promise<apid.VideoAnalyzeJob>;
    cancelAnalyzeJob(): Promise<apid.VideoAnalyzeJob>;
    getWatchHistories(option: apid.GetWatchHistoryOption): Promise<apid.WatchHistoryRecords>;
    deleteWatchHistory(videoFileId: apid.VideoFileId): Promise<void>;
    getPlaybackPosition(videoFileId: apid.VideoFileId): Promise<apid.WatchHistory | null>;
    savePlaybackPosition(videoFileId: apid.VideoFileId, option: apid.UpdatePlaybackPositionOption): Promise<apid.WatchHistory>;
    savePlaybackPositionWithBeacon(videoFileId: apid.VideoFileId, option: apid.UpdatePlaybackPositionOption): void;
    sendToKodi(hostName: string, videoFileId: apid.VideoFileId): Promise<void>;
    uploadedVideoFile(option: apid.UploadVideoFileOption): Promise<apid.RecordedId>;

    /**
     * 録画ファイルに埋め込まれたチャプターを取得する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<apid.VideoChapter[]> チャプターが無い場合は空配列
     */
    getChapters(videoFileId: apid.VideoFileId): Promise<apid.VideoChapter[]>;

    /**
     * 録画ファイルの音声トラック一覧を取得する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<apid.VideoAudioTrack[]>
     */
    getAudioTracks(videoFileId: apid.VideoFileId): Promise<apid.VideoAudioTrack[]>;
}
