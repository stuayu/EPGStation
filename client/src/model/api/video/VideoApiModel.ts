import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IVideoApiModel from './IVideoApiModel';

@injectable()
export default class VideoApiModel implements IVideoApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    /**
     * ビデオファイルの削除
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async delete(videoFileId: apid.VideoFileId): Promise<void> {
        await this.repository.delete(`/videos/${videoFileId}`);
    }

    /**
     * 指定したビデオファイルの長さを取得する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<number> 動画の長さ(秒)
     */
    public async getDuration(videoFileId: apid.VideoFileId): Promise<number> {
        const result = await this.repository.get(`/videos/${videoFileId}/duration`);

        return result.data.duration;
    }

    /**
     * 指定したビデオファイルの実測メタデータを取得する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<apid.VideoFileMetadataResult>
     */
    public async getMetadata(videoFileId: apid.VideoFileId): Promise<apid.VideoFileMetadataResult> {
        return (await this.repository.get(`/videos/${videoFileId}/metadata`)).data;
    }

    /**
     * 指定したビデオファイルを解析し直す
     * @param videoFileId: apid.VideoFileId
     * @return Promise<apid.VideoFileMetadataResult>
     */
    public async analyzeMetadata(videoFileId: apid.VideoFileId): Promise<apid.VideoFileMetadataResult> {
        return (await this.repository.post(`/videos/${videoFileId}/metadata`, {})).data;
    }

    /**
     * 録画ファイルメタデータの解析状況を取得する
     * @return Promise<apid.VideoFileMetadataStatus>
     */
    public async getMetadataStatus(): Promise<apid.VideoFileMetadataStatus> {
        return (await this.repository.get('/videos/metadata')).data;
    }

    /**
     * 未解析の録画ファイルを一括解析する
     * @param option: apid.AnalyzeVideoFilesOption
     * @return Promise<apid.AnalyzeVideoFilesResult>
     */
    public async analyzeAllMetadata(option?: apid.AnalyzeVideoFilesOption): Promise<apid.AnalyzeVideoFilesResult> {
        return (await this.repository.post('/videos/metadata', option ?? {})).data;
    }

    /**
     * 録画ファイルの TS 解析状況を取得する
     * @return Promise<apid.VideoFileMetadataStatus>
     */
    public async getTsInfoStatus(): Promise<apid.VideoFileMetadataStatus> {
        return (await this.repository.get('/videos/tsinfo')).data;
    }

    /**
     * 未解析の TS ファイルを一括解析する
     * @param option: apid.AnalyzeVideoFilesOption
     * @return Promise<apid.AnalyzeVideoFilesResult>
     */
    public async analyzeAllTsInfo(option?: apid.AnalyzeVideoFilesOption): Promise<apid.AnalyzeVideoFilesResult> {
        return (await this.repository.post('/videos/tsinfo', option ?? {})).data;
    }

    /**
     * 解析済みかどうかに関わらず TS ファイルを強制的に再解析する
     * @param option: apid.ReanalyzeTsInfoOption
     * @return Promise<apid.ReanalyzeTsInfoResult>
     */
    public async reanalyzeAllTsInfo(option?: apid.ReanalyzeTsInfoOption): Promise<apid.ReanalyzeTsInfoResult> {
        return (await this.repository.post('/videos/tsinfo/reanalyze', option ?? {})).data;
    }

    public async getPlaybackPosition(videoFileId: apid.VideoFileId): Promise<apid.WatchHistory | null> {
        try {
            return (await this.repository.get(`/videos/${videoFileId}/playback-position`)).data;
        } catch (error: any) {
            if (error?.response?.status === 404) return null;
            throw error;
        }
    }

    public async savePlaybackPosition(videoFileId: apid.VideoFileId, option: apid.UpdatePlaybackPositionOption): Promise<apid.WatchHistory> {
        return (await this.repository.put(`/videos/${videoFileId}/playback-position`, option)).data;
    }

    public savePlaybackPositionWithBeacon(videoFileId: apid.VideoFileId, option: apid.UpdatePlaybackPositionOption): void {
        void fetch(`./api/videos/${videoFileId}/playback-position`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(option),
            keepalive: true,
        });
    }

    /**
     * kodi にビデオリンクを送信する
     * @param hostName: kodi host name
     * @param videoFileId: apid.VideoFileId)
     * @return Promise<void>
     */
    public async sendToKodi(hostName: string, videoFileId: apid.VideoFileId): Promise<void> {
        await this.repository.post(`/videos/${videoFileId}/kodi`, {
            kodiName: hostName,
        });
    }

    /**
     * ビデオファイルををアップロードする
     * @param option: apid.UploadVideoFileOption
     * @return Promise<void>
     */
    public async uploadedVideoFile(option: apid.UploadVideoFileOption): Promise<void> {
        const formData = new FormData();
        formData.append('recordedId', option.recordedId.toString(10));
        formData.append('parentDirectoryName', option.parentDirectoryName);
        if (typeof option.subDirectory !== 'undefined') {
            formData.append('subDirectory', option.subDirectory);
        }
        formData.append('viewName', option.viewName);
        formData.append('fileType', option.fileType);
        if (typeof option.file !== 'undefined') {
            formData.append('file', option.file);
        }
        if (typeof option.localFilePath !== 'undefined') {
            formData.append('localFilePath', option.localFilePath);
        }

        await this.repository.post('/videos/upload', formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });
    }
}
