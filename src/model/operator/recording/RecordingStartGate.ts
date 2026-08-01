import { EitPresentEvent } from './EitPresentParser';

/**
 * 録画開始ゲートの設定
 */
export interface RecordingStartGateConfig {
    // ゲートを有効にするか (false で従来通り最初のデータで録画を開始する)
    enabled: boolean;
    // EIT[p/f] を読めないまま開始してよいと判断するまでの時間 (ms)
    timeoutMs: number;
    // present の番組開始時刻が予約開始時刻よりこれ以上前なら「前の番組」とみなす (ms)
    startMarginMs: number;
}

export const DEFAULT_RECORDING_START_GATE_CONFIG: Readonly<RecordingStartGateConfig> = Object.freeze({
    enabled: true,
    // EIT[p/f] は数秒周期で流れるが、受信状況によっては取れないこともあるので
    // 読めないまま待ち続けて録り逃すより開始する (安全側)
    timeoutMs: 60 * 1000,
    // 番組開始時刻は EPG と実送出で数十秒ずれることがある
    startMarginMs: 2 * 60 * 1000,
});

const clamp = (value: unknown, fallback: number, min: number, max: number): number => {
    if (typeof value !== 'number' || Number.isFinite(value) === false) return fallback;

    return Math.min(Math.max(value, min), max);
};

/**
 * config.yml の recording 設定から開始ゲートの設定を作る
 * @param value: unknown
 * @return RecordingStartGateConfig
 */
export const resolveRecordingStartGateConfig = (value: unknown): RecordingStartGateConfig => {
    const source = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
    const d = DEFAULT_RECORDING_START_GATE_CONFIG;

    return {
        enabled: source.startGateEnabled !== false,
        timeoutMs: clamp(source.startGateTimeoutMs, d.timeoutMs, 0, 60 * 60 * 1000),
        startMarginMs: clamp(source.startGateStartMarginMs, d.startMarginMs, 0, 60 * 60 * 1000),
    };
};

export interface StartGateInput {
    // 予約した番組の eventId (programId 予約のみ。時刻指定予約は null)
    eventId: number | null;
    // 予約の放送開始予定時刻 (UNIX 時刻・ミリ秒)
    reserveStartAt: number;
    // 直近に読めた EIT[p/f] present (まだ読めていない場合は null)
    present: EitPresentEvent | null;
    // ストリームを受け取り始めてからの経過時間 (ms)
    elapsedMs: number;
    config: RecordingStartGateConfig;
}

export type StartGateReason =
    // 目的の番組が present になった
    | 'eventMatched'
    // present の開始時刻が予約開始時刻に達した (時刻指定予約)
    | 'startTimeReached'
    // EIT[p/f] を読めないまま上限に達した
    | 'timeout'
    // ゲートが無効
    | 'disabled'
    // 前の番組が続いている (放送時間未定 = 延長しうる)
    | 'previousProgramExtending'
    // 前の番組が続いている
    | 'previousProgram'
    // まだ EIT[p/f] を読めていない
    | 'waitingForEit';

export interface StartGateDecision {
    // 録画を開始してよいか
    canStart: boolean;
    reason: StartGateReason;
}

/**
 * いま流れているストリームが「予約した番組」かどうかを判断する。
 *
 * 時刻指定予約 (Mirakurun のチャンネルストリーム) は予定時刻から即データが流れるため、
 * 前番組が延長しているとそのまま前番組を録ってしまう。EIT[p/f] present を読み、
 * 前番組が続いている間は録画を始めない。
 *
 * 判断がつかないまま待ち続けると録り逃すため、EIT[p/f] を読めないまま
 * timeoutMs を過ぎた場合は開始する (安全側に倒す)
 * @param input: StartGateInput
 * @return StartGateDecision
 */
export const decideRecordingStart = (input: StartGateInput): StartGateDecision => {
    if (input.config.enabled === false) {
        return { canStart: true, reason: 'disabled' };
    }

    const present = input.present;
    if (present === null) {
        // EIT[p/f] がまだ読めていない。上限を過ぎたら開始する
        return input.elapsedMs >= input.config.timeoutMs
            ? { canStart: true, reason: 'timeout' }
            : { canStart: false, reason: 'waitingForEit' };
    }

    // programId 予約は eventId で厳密に判断できる
    if (input.eventId !== null) {
        if (present.eventId === input.eventId) {
            return { canStart: true, reason: 'eventMatched' };
        }

        return {
            canStart: false,
            reason: present.durationSec === null ? 'previousProgramExtending' : 'previousProgram',
        };
    }

    // 時刻指定予約は開始時刻で判断する。
    // present の開始時刻が予約開始時刻 (マージン込み) 以降なら目的の番組が始まっている
    if (present.startAt === null) {
        // 開始時刻が未定の番組が流れている = 判断材料が無いので上限まで待つ
        return input.elapsedMs >= input.config.timeoutMs
            ? { canStart: true, reason: 'timeout' }
            : { canStart: false, reason: 'previousProgramExtending' };
    }

    if (present.startAt >= input.reserveStartAt - input.config.startMarginMs) {
        return { canStart: true, reason: 'startTimeReached' };
    }

    return {
        canStart: false,
        reason: present.durationSec === null ? 'previousProgramExtending' : 'previousProgram',
    };
};
