import * as apid from '../../../../../api';
import { ClientCapabilities } from '@/util/ClientCapabilityUtil';

export default interface IStreamApiModel {
    getStreamInfo(isHalfWidth: boolean): Promise<apid.StreamInfo>;
    startLiveHLS(channelId: apid.ChannelId, mode: number, audioTrack?: apid.AudioTrackSpecifier): Promise<apid.StreamId>;
    startRecordedHLS(
        videoFileId: apid.VideoFileId,
        ss: number,
        mode: number,
        audioTrack?: apid.AudioTrackSpecifier,
    ): Promise<apid.StreamId>;
    stop(streamId: apid.StreamId): Promise<void>;
    stopAll(): Promise<void>;
    keep(streamId: apid.StreamId): Promise<void>;
    getLivePlaybackOptions(channelId: apid.ChannelId, client: ClientCapabilities, requestedPresetId?: string): Promise<apid.PlaybackOptions>;
    getRecordedPlaybackOptions(videoFileId: apid.VideoFileId, client: ClientCapabilities, requestedPresetId?: string): Promise<apid.PlaybackOptions>;
}
