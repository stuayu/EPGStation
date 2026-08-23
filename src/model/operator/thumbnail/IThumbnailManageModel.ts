import * as apid from '../../../../api';

export default interface IThumbnailManageModel {
    add(videoFileId: apid.VideoFileId, profile?: 'fast' | 'balanced' | 'quality'): void;
    delete(thumbnailId: apid.ThumbnailId): Promise<void>;
    regenerate(): Promise<void>;
    regenerateRecorded(recordedId: apid.RecordedId, profile?: 'fast' | 'balanced' | 'quality'): Promise<void>;
    fileCleanup(): Promise<void>;
}
