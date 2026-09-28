import * as apid from '../../../../../../api';
import { RecordedDisplayData } from '../IRecordedUtil';

export interface URLInfo {
    host: string;
    subDir: string;
}

export default interface IRecordedDetailState {
    clearData(): void;
    fetchData(recordedId: apid.RecordedId, isHalfWidth: boolean): Promise<void>;
    getRecordingSessions(): apid.RecordingSessionItem[];
    getRecorded(): RecordedDisplayData | null;
    getVideoURL(video: apid.VideoFile): string | null;
    getVideoRawURL(video: apid.VideoFile): string;
    getVideoDownloadURL(video: apid.VideoFile): string | null;
    getVideoDownloadRawURL(video: apid.VideoFile): string;
    getVideoPlayListURL(video: apid.VideoFile): string;
    stopEncode(): Promise<void>;
}
