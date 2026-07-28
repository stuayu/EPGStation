/**
 * 録画開始のリトライ方針。
 *
 * 録画開始が失敗する理由は性質の違う 2 つがある。
 *
 * - **番組がまだ始まっていない** (`waitingForEvent`):
 *   Mirakurun は EIT[p/f] で対象の event_id が現在番組になるまでデータを流さない。
 *   前の番組が「放送時刻未定」(ARIB の duration = 0xFFFFFF) で延長している間はこの状態が続く。
 *   これは異常ではなく待つべき状態なので、長時間 (既定 3 時間) 待てるようにする。
 * - **チューナーが開けない・ソケット断など** (`error`):
 *   こちらは復旧しない可能性があるため、従来どおり回数で見切る。
 *
 * 両者を同じ回数で数えると、延長待ちがエラー用の回数を食い潰して
 * 「まだ始まっていないだけ」の番組を諦めてしまうため分けている。
 */

export type RecordingRetryReason = 'waitingForEvent' | 'error';

export interface RecordingRetryConfig {
    // 番組開始を待つ上限 (ms)
    startWaitLimitMs: number;
    // 開始待ち中の再試行間隔 (ms)
    startWaitIntervalMs: number;
    // ストリーム開始後、最初のデータを待つ時間 (ms)。これを超えると「まだ始まっていない」と判断する
    firstDataTimeoutMs: number;
    // エラー時、短い間隔で再試行する回数と間隔 (一時的な失敗の救済)
    errorFastRetryCount: number;
    errorFastRetryIntervalMs: number;
    // エラー時、上記の後に長い間隔で再試行する回数と間隔
    errorRetryCount: number;
    errorRetryIntervalMs: number;
}

export const DEFAULT_RECORDING_RETRY_CONFIG: Readonly<RecordingRetryConfig> = Object.freeze({
    // 野球中継の延長などを見込んで既定 3 時間まで待つ
    startWaitLimitMs: 3 * 60 * 60 * 1000,
    startWaitIntervalMs: 60 * 1000,
    firstDataTimeoutMs: 5 * 1000,
    errorFastRetryCount: 3,
    errorFastRetryIntervalMs: 5 * 1000,
    errorRetryCount: 27,
    errorRetryIntervalMs: 60 * 1000,
});

const clamp = (value: unknown, fallback: number, min: number, max: number): number => {
    if (typeof value !== 'number' || Number.isFinite(value) === false) return fallback;
    return Math.min(Math.max(value, min), max);
};

/**
 * 設定値を解釈する。未指定・範囲外は既定値へ丸める
 * @param value: unknown config.yml の recording 設定
 * @return RecordingRetryConfig
 */
export const resolveRecordingRetryConfig = (value: unknown): RecordingRetryConfig => {
    const source = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
    const d = DEFAULT_RECORDING_RETRY_CONFIG;
    return {
        // 0 を指定すると「待たない」= 従来相当の挙動になる
        startWaitLimitMs: clamp(source.startWaitLimitMs, d.startWaitLimitMs, 0, 24 * 60 * 60 * 1000),
        startWaitIntervalMs: clamp(source.startWaitIntervalMs, d.startWaitIntervalMs, 1000, 60 * 60 * 1000),
        firstDataTimeoutMs: clamp(source.firstDataTimeoutMs, d.firstDataTimeoutMs, 1000, 10 * 60 * 1000),
        errorFastRetryCount: clamp(source.errorFastRetryCount, d.errorFastRetryCount, 0, 100),
        errorFastRetryIntervalMs: clamp(
            source.errorFastRetryIntervalMs,
            d.errorFastRetryIntervalMs,
            1000,
            60 * 60 * 1000,
        ),
        errorRetryCount: clamp(source.errorRetryCount, d.errorRetryCount, 0, 1000),
        errorRetryIntervalMs: clamp(source.errorRetryIntervalMs, d.errorRetryIntervalMs, 1000, 60 * 60 * 1000),
    };
};

export interface RetryDecisionInput {
    // 直前の失敗の理由
    reason: RecordingRetryReason;
    // これまでのエラー起因の再試行回数
    errorRetryCount: number;
    // 番組開始を待ち始めてからの経過時間 (ms)
    waitedMs: number;
    config: RecordingRetryConfig;
}

export interface RetryDecision {
    // 再試行するか
    retry: boolean;
    // 次の試行までの待ち時間 (ms)
    delayMs: number;
}

/**
 * 次に再試行するかどうかと、その待ち時間を決める
 * @param input: RetryDecisionInput
 * @return RetryDecision
 */
export const decideRecordingRetry = (input: RetryDecisionInput): RetryDecision => {
    const config = input.config;

    if (input.reason === 'waitingForEvent') {
        // 番組がまだ始まっていないだけなので、上限まで待ち続ける
        if (input.waitedMs >= config.startWaitLimitMs) return { retry: false, delayMs: 0 };

        // 上限を超えない範囲で次回を刻む
        const rest = config.startWaitLimitMs - input.waitedMs;
        return { retry: true, delayMs: Math.min(config.startWaitIntervalMs, rest) };
    }

    if (input.errorRetryCount < config.errorFastRetryCount) {
        return { retry: true, delayMs: config.errorFastRetryIntervalMs };
    }
    if (input.errorRetryCount < config.errorFastRetryCount + config.errorRetryCount) {
        return { retry: true, delayMs: config.errorRetryIntervalMs };
    }
    return { retry: false, delayMs: 0 };
};
