import * as apid from '../../../../../api';

export default interface ILiveHLSVideoState {
    start(channelId: apid.ChannelId, mode: number, audioTrack?: apid.AudioTrackSpecifier): Promise<void>;
    stop(): Promise<void>;
    stopCurrentStream(): Promise<void>;
    stopPreviousStream(): Promise<void>;
    getStreamId(): apid.StreamId | null;
    isEnabled(): Promise<boolean>;
}
