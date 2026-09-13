import * as apid from '../../../../../../api';
import type { RecordedStreamType } from '@/util/StreamingTypeUtil';

export type { RecordedStreamType } from '@/util/StreamingTypeUtil';

export interface StreamConfigItem {
    title: string;
    value: number;
}

export default interface IRecordedDetailSelectStreamState {
    isOpen: boolean;
    streamTypeItems: RecordedStreamType[];
    streamModeItems: StreamConfigItem[];
    selectedStreamType: RecordedStreamType | undefined;
    selectedStreamMode: number | undefined;
    title: string | null;
    open(videoFile: apid.VideoFile, recordedId: apid.RecordedId): void;
    close(): void;
    updateModeItems(): void;
    getVideoFileId(): apid.VideoFileId | null;
    getRecordedId(): apid.RecordedId | null;
}
