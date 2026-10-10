import * as apid from '../../../../api';

/**
 * 番組が終わったことを放送側の情報で確認できた終了理由
 * boundary: EIT[p/f] の present が別番組へ切り替わった / scheduled-end: 予定終了時刻に達した
 */
const PROGRAM_FINISHED_REASONS = ['boundary', 'scheduled-end'];

/**
 * 録画履歴 (重複除外の照合元) に保存する終了時刻を決める。
 *
 * 重複判定は「履歴の終了時刻 <= 現在時刻」の履歴だけを見る。番組表上の終了時刻をそのまま保存すると、
 * 番組が予定より早く終わった場合 (EIT の切替が数秒早い・放送時間未定で暫定の終了時刻が入っている) に
 * 履歴が未来の時刻になり、終了直後のルール再評価では重複にならず、次の定期更新まで再放送が予約されたままになる。
 * 番組の終了を確認できているときだけ現在時刻で頭打ちにする。
 * 途中で切れた録画 (transport-lost など) は番組がまだ続いているため、番組表の終了時刻を保つ
 * @param endAt: apid.UnixtimeMS 番組表上の終了時刻
 * @param now: apid.UnixtimeMS 現在時刻
 * @param endReason: string | null 録画の終了理由
 * @return apid.UnixtimeMS 履歴へ保存する終了時刻
 */
export const resolveRecordedHistoryEndAt = (
    endAt: apid.UnixtimeMS,
    now: apid.UnixtimeMS,
    endReason: string | null,
): apid.UnixtimeMS => {
    if (endReason === null || PROGRAM_FINISHED_REASONS.includes(endReason) === false) {
        return endAt;
    }

    return Math.min(endAt, now);
};

/**
 * 番組指定予約の録画を重複除外用の履歴へ保存するか判定する。
 * @param reserve 番組指定・時刻指定・イベントリレーの予約条件
 * @param isNeedDeleteReservation 録画が終了して予約の削除が必要か
 * @return boolean 履歴を保存する場合 true
 */
export const shouldSaveRecordedHistory = (
    reserve: { programId: apid.ProgramId | null; isTimeSpecified: boolean; isEventRelay: boolean },
    isNeedDeleteReservation: boolean,
): boolean => {
    return (
        reserve.programId !== null &&
        reserve.isTimeSpecified === false &&
        reserve.isEventRelay === false &&
        isNeedDeleteReservation === true
    );
};
