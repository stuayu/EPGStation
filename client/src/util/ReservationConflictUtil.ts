import * as apid from '../../../api';

/**
 * 予約競合の利用者向け説明文を生成する
 */
export default class ReservationConflictUtil {
    /**
     * 競合内容を一覧・詳細で共通の文言にする
     * @param conflict: apid.ReservationConflict | undefined
     * @return string | null
     */
    public static format(conflict: apid.ReservationConflict | undefined): string | null {
        if (conflict === undefined) {
            return null;
        }

        const seconds = Math.ceil(conflict.affectedMs / 1000);
        const reserves = conflict.conflictingReserveIds.length > 0 ? `予約 ID ${conflict.conflictingReserveIds.join(', ')}` : '他の予約';

        if (conflict.type === 'MARGIN_OVERLAP') {
            return `チューナー準備時間が${reserves}と重複`;
        }
        if (conflict.type === 'PARTIAL_HEAD') return `先頭 ${seconds} 秒が欠損`;
        if (conflict.type === 'PARTIAL_TAIL') return `末尾 ${seconds} 秒が欠損`;
        if (conflict.type === 'PRIORITY_PREEMPTED') return `優先度で${reserves}に押し出された`;
        if (conflict.type === 'PARTIAL') return `途中 ${seconds} 秒が欠損`;

        return `${reserves}と競合 (録画できない時間 ${seconds} 秒)`;
    }
}
