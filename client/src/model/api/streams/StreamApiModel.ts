import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IStreamApiModel, { PlaybackQueryPreference } from './IStreamApiModel';
import { ClientCapabilities } from '@/util/ClientCapabilityUtil';

@injectable()
export default class StreamApiModel implements IStreamApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    /**
     * ストリーム情報を取得する
     * @param isHalfWidth: boolean 半角で取得するか
     * @return Promise<apid.StreamInfo>
     */
    public async getStreamInfo(isHalfWidth: boolean): Promise<apid.StreamInfo> {
        const result = await this.repository.get('/streams', {
            params: {
                isHalfWidth: isHalfWidth,
            },
        });

        return result.data;
    }

    /**
     * ライブ HLS ストリームを開始する
     * @param channelId: apid.ChannelId
     * @param mode: number
     * @return Promise<apid.StreamId>
     */
    public async startLiveHLS(
        channelId: apid.ChannelId,
        mode: number,
        audioTrack?: apid.AudioTrackSpecifier,
    ): Promise<apid.StreamId> {
        const result = await this.repository.get(`/streams/live/${channelId}/hls`, {
            params: {
                mode: mode,
                audioTrack: audioTrack,
            },
        });

        return result.data.streamId;
    }

    /**
     * 録画 HLS ストリームを開始する
     * @param videoFileId: apid.VideoFileId
     * @param ss: number 再生位置
     * @param mode: ストリーミング設定
     * @return Promise<apid.StreamId>
     */
    public async startRecordedHLS(
        videoFileId: apid.VideoFileId,
        ss: number,
        mode: number,
        audioTrack?: apid.AudioTrackSpecifier,
    ): Promise<apid.StreamId> {
        const result = await this.repository.get(`/streams/recorded/${videoFileId}/hls`, {
            params: {
                // ss は api.yml で integer。小数のまま投げるとサーバ側の parseInt で
                // 切り捨てられ、同じ位置でも URL が一致しなくなる。負値も受け付けない
                ss: Math.max(0, Math.floor(Number.isFinite(ss) === true ? ss : 0)),
                mode: mode,
                audioTrack: audioTrack,
            },
        });

        return result.data.streamId;
    }

    /**
     * 指定したストリームを停止
     * @param streamId: apid.StreamId
     * @return Promise<void>
     */
    public async stop(streamId: apid.StreamId): Promise<void> {
        await this.repository.delete(`/streams/${streamId}`);
    }

    /**
     * 全てのストリームを停止
     * @return Promise<void>
     */
    public async stopAll(): Promise<void> {
        await this.repository.delete('/streams');
    }

    /**
     * 指定したストリームの停止タイマーを更新する
     * @param streamId: apid.StreamId
     * @return Promise<void>
     */
    public async keep(streamId: apid.StreamId): Promise<void> {
        await this.repository.put(`/streams/${streamId}/keep`);
    }

    /**
     * ライブ再生の画質選択肢を取得する
     */
    public async getLivePlaybackOptions(channelId: apid.ChannelId, client: ClientCapabilities, requestedPresetId?: string, container?: apid.PlaybackContainer, preference?: PlaybackQueryPreference): Promise<apid.PlaybackOptions> {
        const result = await this.repository.get(`/streams/live/${channelId}/playback-options`, { params: { ...client, profile: requestedPresetId, container, ...(preference ?? {}) } });

        return result.data;
    }

    /**
     * 録画再生の画質選択肢を取得する
     */
    public async getRecordedPlaybackOptions(videoFileId: apid.VideoFileId, client: ClientCapabilities, requestedPresetId?: string, container?: apid.PlaybackContainer, preference?: PlaybackQueryPreference): Promise<apid.PlaybackOptions> {
        const result = await this.repository.get(`/videos/${videoFileId}/playback-options`, { params: { ...client, profile: requestedPresetId, container, ...(preference ?? {}) } });

        return result.data;
    }
}
