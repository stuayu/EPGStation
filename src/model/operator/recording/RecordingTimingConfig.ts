/**
 * 録画のタイミング設定。
 *
 * 3 つの「N 秒」を分けて扱う。混同しやすいので用語を固定する。
 *
 * - **張り付き (prep)**: 予約開始時刻の N 秒前にチューナーを確保してストリームを開き、
 *   EIT[p/f] の監視を始める。ここではまだ録画ファイルへ書かない。
 * - **開始マージン (startMargin)**: 予約開始時刻の N 秒前から実際の録画開始を許可する。
 * - **終了マージン (endMargin)**: 予約終了時刻の N 秒後まで録画を続ける。
 *
 * 開始・終了マージンの既定は EDCB (EpgTimerSrv) の既定値に合わせて 5 秒ずつ。
 *
 * いずれも**負値は受け付けない** (0 未満は 0 に丸める)。
 */

export interface RecordingTimingConfig {
    // 予約開始時刻の何 ms 前からチャンネルを開いて張り付くか
    prepMs: number;
    // 予約開始時刻の何 ms 前から録画開始してよいか
    startMarginMs: number;
    // 予約終了時刻の何 ms 後まで録画するか
    endMarginMs: number;
}

/**
 * 既定の張り付き時間 (ms)。
 * EDCB の「録画開始何分前から起動するか」の既定 (2 分前) に合わせてある。
 */
export const DEFAULT_PREP_MS = 2 * 60 * 1000;

/**
 * 既定の開始・終了マージン (ms)。
 * EDCB (EpgTimerSrv) の既定値 (開始 5 秒 / 終了 5 秒) に合わせてある。
 */
export const DEFAULT_START_MARGIN_MS = 5 * 1000;
export const DEFAULT_END_MARGIN_MS = 5 * 1000;

export const DEFAULT_RECORDING_TIMING_CONFIG: Readonly<RecordingTimingConfig> = Object.freeze({
    prepMs: DEFAULT_PREP_MS,
    startMarginMs: DEFAULT_START_MARGIN_MS,
    endMarginMs: DEFAULT_END_MARGIN_MS,
});

// 張り付いてから録画開始判定までに最低限確保したい時間。
// 開始マージンと張り付きが同時刻だと、ストリームを開いた瞬間に開始判定が走り
// EIT を 1 度も読めないまま録画が始まる
const MIN_PREP_LEAD_MS = 5 * 1000;

// 極端な値で予約管理が壊れないようにする上限
const MAX_SEC = 6 * 60 * 60;

/**
 * 秒指定の設定値を ms へ直す。負値・非数・範囲外は既定へ丸める
 * @param value: unknown
 * @param fallbackSec: number
 * @return number ms
 */
const toMs = (value: unknown, fallbackSec: number): number => {
    if (typeof value !== 'number' || Number.isFinite(value) === false) {
        return fallbackSec * 1000;
    }

    // マイナスは受け付けない
    return Math.round(Math.min(MAX_SEC, Math.max(0, value)) * 1000);
};

/**
 * config から録画タイミング設定を組み立てる。
 *
 * 時刻指定予約の既存設定 (`timeSpecifiedStartMargin` / `timeSpecifiedEndMargin`) は
 * そのまま残し、新しい共通設定とは**大きい方**を採る。これにより新設定を入れない限り
 * 従来の挙動が変わらず、新設定は全予約共通の下限として働く。
 *
 * @param recording: unknown config.recording 相当
 * @param timeSpecifiedStartMarginSec: number config.timeSpecifiedStartMargin
 * @param timeSpecifiedEndMarginSec: number config.timeSpecifiedEndMargin
 * @return RecordingTimingConfig
 */
export const resolveRecordingTimingConfig = (
    recording: unknown,
    timeSpecifiedStartMarginSec: number,
    timeSpecifiedEndMarginSec: number,
): RecordingTimingConfig => {
    const source = recording !== null && typeof recording === 'object' ? (recording as { [key: string]: unknown }) : {};

    const startMarginMs = Math.max(
        toMs(source.startMarginSec, DEFAULT_START_MARGIN_MS / 1000),
        // 既存の時刻指定設定は未設定でも 0 扱い。新設定側の既定を打ち消さないようにする
        toMs(timeSpecifiedStartMarginSec, 0),
    );
    const endMarginMs = Math.max(
        toMs(source.endMarginSec, DEFAULT_END_MARGIN_MS / 1000),
        toMs(timeSpecifiedEndMarginSec, 0),
    );

    // 張り付きは必ず録画開始マージンより前にする
    const prepMs = Math.max(toMs(source.prepRecSec, DEFAULT_PREP_MS / 1000), startMarginMs + MIN_PREP_LEAD_MS);

    return {
        prepMs: prepMs,
        startMarginMs: startMarginMs,
        endMarginMs: endMarginMs,
    };
};
