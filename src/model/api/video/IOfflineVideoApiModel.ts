import internal from 'stream';
import * as apid from '../../../../api';

export interface OfflineVideoStreamResult {
    streamId: apid.StreamId;
    stream: internal.Readable;
    metadata: apid.OfflineVideoStreamMetadata;
    cleanup(): Promise<void>;
}

export default interface IOfflineVideoApiModel {
    startOfflineStream(
        videoFileId: apid.VideoFileId,
        profile: string,
        audioTrack?: apid.AudioTrackSpecifier,
    ): Promise<OfflineVideoStreamResult>;
}
