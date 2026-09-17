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
        format?: apid.OfflineVideoFormat,
    ): Promise<OfflineVideoStreamResult>;
    getOriginalFilePath(videoFileId: apid.VideoFileId): Promise<{ path: string } | null>;
    getOriginalMpeg2FilePath(videoFileId: apid.VideoFileId): Promise<{ path: string } | null>;
}
