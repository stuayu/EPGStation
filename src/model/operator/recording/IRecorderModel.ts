import Reserve from '../../../db/entities/Reserve';
import RecordingSession from '../../../db/entities/RecordingSession';
import RecordingAttempt from '../../../db/entities/RecordingAttempt';
import Recorded from '../../../db/entities/Recorded';
import VideoFile from '../../../db/entities/VideoFile';

export interface RecordingResumeInfo {
    session: RecordingSession;
    attempts: RecordingAttempt[];
    recorded: Recorded;
    videoFile: VideoFile;
}

export type RecorderModelProvider = () => Promise<IRecorderModel>;

export default interface IRecorderModel {
    setTimer(reserve: Reserve, isSuppressLog: boolean): boolean;
    setResumeTimer(reserve: Reserve, isSuppressLog: boolean, info: RecordingResumeInfo): boolean;
    shutdown(): Promise<void>;
    cancel(isPlanToDelete: boolean): Promise<void>;
    update(newReserve: Reserve, isSuppressLog: boolean): Promise<void>;
    resetTimer(): boolean;
}
