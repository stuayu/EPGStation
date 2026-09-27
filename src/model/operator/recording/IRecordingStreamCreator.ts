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
    /** stream の終了理由を記録する (最初の理由を保持) */
    markClose(stream: http.IncomingMessage, reason: Exclude<IRecordingStreamCreator.CloseReason, null>): void;
    /** 理由を記録して stream を破棄する */
    closeStream(stream: http.IncomingMessage, reason: Exclude<IRecordingStreamCreator.CloseReason, null>): void;
}

namespace IRecordingStreamCreator {
    // チューナー再利用時に許容する末尾欠け (ms)。
    // 録画の張り付き時間は recording.prepRecSec で設定する (RecordingTimingConfig) が、
    // こちらは「実行中の録画をどれだけ切ってよいか」なので連動させない
    export const PREP_TIME = 15 * 1000;
    export type CloseReason =
        | 'scheduled-end'
        | 'boundary'
        | 'canceled'
        | 'tuner-handoff'
        | 'superseded'
        | 'obsolete'
        | 'teardown'
        | 'write-error'
        | 'reconnect-no-data'
        | null;
    export type CloseAction = 'ignore' | 'finish' | 'inspect';

    /** close reason から Recorder の終了動作を決める */
    export const getCloseAction = (reason: CloseReason): CloseAction => {
        if (reason === 'superseded' || reason === 'obsolete' || reason === 'teardown' || reason === 'write-error')
            return 'ignore';
        if (reason === 'canceled' || reason === 'tuner-handoff' || reason === 'boundary' || reason === 'scheduled-end')
            return 'finish';
        return 'inspect';
    };
}

export default IRecordingStreamCreator;
