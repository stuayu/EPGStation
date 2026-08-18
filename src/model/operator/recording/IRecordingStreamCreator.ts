import * as http from 'http';
import * as mapid from '../../../../node_modules/mirakurun/api';
import Reserve from '../../../db/entities/Reserve';

interface IRecordingStreamCreator {
    setTuner(tuners: mapid.TunerDevice[]): void;
    create(reserve: Reserve, abortSignal: AbortSignal): Promise<http.IncomingMessage>;
    /** service stream の予約終了ハードタイマーを更新する */
    changeEndAt(reserve: Reserve): void;
    /** stream が録画側の正常終了条件で閉じられた理由を返す */
    getCloseReason(stream: http.IncomingMessage): IRecordingStreamCreator.CloseReason;
}

namespace IRecordingStreamCreator {
    export const PREP_TIME = 15 * 1000;
    export type CloseReason = 'scheduled-end' | null;
}

export default IRecordingStreamCreator;
