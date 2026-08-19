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
    // チューナー再利用時に許容する末尾欠け (ms)。
    // 録画の張り付き時間は recording.prepRecSec で設定する (RecordingTimingConfig) が、
    // こちらは「実行中の録画をどれだけ切ってよいか」なので連動させない
    export const PREP_TIME = 15 * 1000;
    export type CloseReason = 'scheduled-end' | null;
}

export default IRecordingStreamCreator;
