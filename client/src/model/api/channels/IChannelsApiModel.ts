import * as apid from '../../../../../api';

export default interface IChannelsApiModel {
    getChannels(): Promise<apid.ChannelItem[]>;
    getLiveAudioTracks(channelId: apid.ChannelId): Promise<apid.VideoAudioTrack[]>;
}
