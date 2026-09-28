import * as apid from '../../../../api';
import * as mapid from '../../../../node_modules/mirakurun/api';
import { IReserveUpdateValues } from '../../event/IReserveEvent';

export default interface IRecordingManageModel {
    /** 録画中・準備中の件数を返す */
    getPowerCounts(): { recordingCount: number; recordingPreparationCount: number };
    setTuner(tuners: mapid.TunerDevice[]): void;
    cleanup(): Promise<void>;
    setupStartupTimers(): Promise<void>;
    shutdown(): Promise<void>;
    update(diff: IReserveUpdateValues): Promise<void>;
    hasReserve(reserveId: apid.ReserveId): boolean;
    cancel(reserveId: apid.ReserveId, isPlanToDelete: boolean): Promise<void>;
    resetTimer(): void;
}
