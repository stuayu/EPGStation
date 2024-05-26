import * as apid from '../../../api';
import Recorded from '../../db/entities/Recorded';
import Reserve from '../../db/entities/Reserve';

export default interface IRecordingEvent {
    emitStartPrepRecording(reserve: Reserve): void;
    emitCancelPrepRecording(reserve: Reserve): void;
    emitPrepRecordingFailed(reserve: Reserve): void;
    emitStartRecording(reserve: Reserve, recorded: Recorded): void;
    emitRecordingFailed(reserve: Reserve, recorded: Recorded | null): void;
    emitRecordingRetryOver(reserve: Reserve): void;
    emitFinishRecording(reserve: Reserve, recorded: Recorded, isNeedDeleteReservation: boolean): void;
    emitEventRelay(programs: { programId: apid.ProgramId; parentReserve: Reserve }[]): void;
    setStartPrepRecording(callback: (reserve: Reserve) => void): void;
    setCancelPrepRecording(callback: (reserve: Reserve) => void): void;
    setPrepRecordingFailed(callback: (reserve: Reserve) => void): void;
    setStartRecording(callback: (reserve: Reserve, recorded: Recorded) => void): void;
    setRecordingFailed(callback: (reserve: Reserve, recorded: Recorded | null) => void): void;
    setRecordingRetryOver(callback: (reserve: Reserve) => void): void;
    setFinishRecording(
        callback: (reserve: Reserve, recorded: Recorded, isNeedDeleteReservation: boolean) => void,
    ): void;
    setEventRelay(callback: (programs: { programId: apid.ProgramId; parentReserve: Reserve }[]) => void): void;
}
