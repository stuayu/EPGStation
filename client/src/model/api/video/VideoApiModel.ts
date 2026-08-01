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

    /**
     * 実行中・直近の一括解析ジョブを取得する
     * @return Promise<apid.VideoAnalyzeJob>
     */
    public async getAnalyzeJob(): Promise<apid.VideoAnalyzeJob> {
        return (await this.repository.get('/videos/analyze')).data;
    }

    /**
     * 一括解析ジョブを開始する (処理はサーバ側で進む)
     * @param option: apid.StartVideoAnalyzeJobOption
     * @return Promise<apid.VideoAnalyzeJob>
     */
    public async startAnalyzeJob(option: apid.StartVideoAnalyzeJobOption): Promise<apid.VideoAnalyzeJob> {
        return (await this.repository.post('/videos/analyze', option)).data;
    }

    /**
     * 実行中の一括解析ジョブに中断を要求する
     * @return Promise<apid.VideoAnalyzeJob>
     */
    public async cancelAnalyzeJob(): Promise<apid.VideoAnalyzeJob> {
        return (await this.repository.delete('/videos/analyze')).data;
    }

    /**
     * 視聴履歴を最後に見た順で取得する
     * @param option: apid.GetWatchHistoryOption
     * @return Promise<apid.WatchHistoryRecords>
     */
    public async getWatchHistories(option: apid.GetWatchHistoryOption): Promise<apid.WatchHistoryRecords> {
        return (await this.repository.get('/watch-history', { params: option })).data;
    }

    /**
     * 視聴履歴を 1 件削除する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async deleteWatchHistory(videoFileId: apid.VideoFileId): Promise<void> {
        await this.repository.delete(`/watch-history/${videoFileId}`);
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
     * recordedId を省略した場合、サーバーが TS を解析して番組情報を作る
     * @param option: apid.UploadVideoFileOption
     * @return Promise<apid.RecordedId> 紐付いた録画番組
     */
    public async uploadedVideoFile(option: apid.UploadVideoFileOption): Promise<apid.RecordedId> {
        const formData = new FormData();
        if (typeof option.recordedId !== 'undefined') {
            formData.append('recordedId', option.recordedId.toString(10));
        }
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

        const result = await this.repository.post('/videos/upload', formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });

        return result.data.recordedId;
    }
}
