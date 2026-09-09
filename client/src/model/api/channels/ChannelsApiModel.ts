import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IChannelsApiModel from './IChannelsApiModel';

@injectable()
export default class ChannelsApiModel implements IChannelsApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    public async getChannels(): Promise<apid.ChannelItem[]> {
        const result = await this.repository.get('/channels');

        return result.data;
    }

    /**
     * ライブ視聴で選べる音声トラック一覧 (放送中番組の音声 ES) を取得する
     * @param channelId: apid.ChannelId
     * @return Promise<apid.VideoAudioTrack[]>
     */
    public async getLiveAudioTracks(channelId: apid.ChannelId): Promise<apid.VideoAudioTrack[]> {
        const result = await this.repository.get(`/channels/${channelId}/audio-tracks`);

        return result.data.tracks;
    }
}
