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
    // programId 予約で別 event_id が固着した場合の安全弁 (ms)
    hardTimeoutMs: number;
}

export const DEFAULT_RECORDING_START_GATE_CONFIG: Readonly<RecordingStartGateConfig> = Object.freeze({
    enabled: true,
    // EIT[p/f] は数秒周期で流れるが、受信状況によっては取れないこともあるので
    // 読めないまま待ち続けて録り逃すより開始する (安全側)
    timeoutMs: 60 * 1000,
    // 番組開始時刻は EPG と実送出で数十秒ずれることがある
    startMarginMs: 2 * 60 * 1000,
    hardTimeoutMs: 5 * 60 * 1000,
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
        hardTimeoutMs: clamp(source.hardStartGateTimeoutMs, d.hardTimeoutMs, 0, 24 * 60 * 60 * 1000),
    };
};

export interface StartGateInput {
    // 予約した番組の eventId (programId 予約のみ。時刻指定予約は null)
    eventId: number | null;
    // 予約の放送開始予定時刻 (UNIX 時刻・ミリ秒)
    reserveStartAt: number;
    // 直近に読めた EIT[p/f] present (まだ読めていない場合は null)
    present: EitPresentEvent | null;
    // EIT[p/f] following。時刻指定予約では present の更新前に開始時刻を判断するために使う
    following?: EitPresentEvent | null;
    // ストリームを受け取り始めてからの経過時間 (ms)
    elapsedMs: number;
    // 実際の現在時刻 (UNIX 時刻・ミリ秒)。省略時は開始マージンを判定しない
    currentAt?: number;
    // 時刻指定予約の実録画開始マージン (ms)
    recordingStartMarginMs?: number;
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
    // 目的の番組は検出したが、録画開始マージンまで待つ
    | 'waitingForStartMargin'
    // まだ EIT[p/f] を読めていない
    | 'waitingForEit';
// programId の EIT fallback (診断用に soft / hard を区別する)
export type ProgramFallbackReason = 'eitSoftTimeout' | 'eitHardTimeout' | 'followingTimeReached';

export interface StartGateDecision {
    // 録画を開始してよいか
    canStart: boolean;
    reason: StartGateReason | ProgramFallbackReason;
}

/**
 * 前の番組が続いていると判断したときの扱いを決める。
 *
 * 放送時間未定 (延長しうる) の間は開始ゲートの上限まで待つ。ここで早く開始すると
 * 延長中の前番組を録ってしまう一方、無期限に待つと次番組を取り逃すため。
 * 尺が確定している別番組が流れ続けている場合は、EIT と予約の食い違い
 * (放送側の event_id 振り直しなど) が疑われるので上限を過ぎたら開始する。
 * @param present: EitPresentEvent
 * @param input: StartGateInput
 * @return StartGateDecision
 */
const decidePreviousProgram = (present: EitPresentEvent, input: StartGateInput): StartGateDecision => {
    if (present.durationSec === null) {
        // 放送時間未定の前番組でも、EIT の更新を取りこぼすと次番組が始まっても
        // 永久に録画を開始できない。開始ゲートの上限を録画取り逃し防止の安全弁
        // として適用する。
        return input.elapsedMs >= input.config.timeoutMs
            ? { canStart: true, reason: 'timeout' }
            : { canStart: false, reason: 'previousProgramExtending' };
    }

    return input.elapsedMs >= input.config.timeoutMs
        ? { canStart: true, reason: 'timeout' }
        : { canStart: false, reason: 'previousProgram' };
};

/**
 * いま流れているストリームが「予約した番組」かどうかを判断する。
 *
 * 時刻指定予約 (Mirakurun のチャンネルストリーム) は予定時刻から即データが流れるため、
 * 前番組が延長しているとそのまま前番組を録ってしまう。EIT[p/f] present を読み、
 * 前番組が続いている間は録画を始めない。
 *
 * 判断がつかないまま待ち続けると録り逃すため、EIT[p/f] を読めない場合と
 * 尺の確定した別番組が流れ続けている場合は timeoutMs を過ぎたら開始する (安全側に倒す)。
 * ただし放送時間未定 (延長中) の番組が流れている間も、上限を過ぎたら開始する
 * @param input: StartGateInput
 * @return StartGateDecision
 */
export const decideRecordingStart = (input: StartGateInput): StartGateDecision => {
    if (input.config.enabled === false) {
        return { canStart: true, reason: 'disabled' };
    }

    // EIT の present でも 1=not running / 2=starts in a few seconds は現在番組ではない。
    // 明示された異常状態だけ無効化し、running_status=0 の既存放送波は従来どおり扱う。
    const present = input.present?.runningStatus === 1 || input.present?.runningStatus === 2 ? null : input.present;
    const following = input.following ?? null;
    // タイムアウトは EIT を読めない場合の安全弁だが、予約時刻より前に
    // 録画を始めてよいという意味ではない。準備開始直後に timeoutMs=0
    // などが指定されても、時刻指定予約の開始マージンまでは待つ。
    // このガードは時刻指定予約専用。programId 予約は event_id 一致で番組を特定できるため、
    // 放送が予定より早く始まった場合はその時点から録りたい
    const isBeforeRecordingStartMargin =
        input.eventId === null &&
        input.currentAt !== undefined &&
        input.recordingStartMarginMs !== undefined &&
        input.currentAt < input.reserveStartAt - input.recordingStartMarginMs;
    if (isBeforeRecordingStartMargin === true) {
        return { canStart: false, reason: 'waitingForStartMargin' };
    }

    if (
        input.eventId === null &&
        following !== null &&
        following.startAt !== null &&
        input.currentAt !== undefined &&
        following.startAt > input.currentAt + (input.recordingStartMarginMs ?? 0) &&
        input.elapsedMs < input.config.timeoutMs
    ) {
        return {
            canStart: false,
            reason: present?.durationSec === null ? 'previousProgramExtending' : 'previousProgram',
        };
    }

    // ARIB TR-B14 は番組開始を following の start_time で判定する。
    // present が前番組のままでも、following が予約番組を示していれば
    // EIT[p/f] の present 更新を待って録画開始を遅らせない。
    if (
        input.eventId === null &&
        following !== null &&
        following.startAt !== null &&
        following.startAt >= input.reserveStartAt - input.config.startMarginMs &&
        input.currentAt !== undefined &&
        input.currentAt >= following.startAt - (input.recordingStartMarginMs ?? 0)
    ) {
        return { canStart: true, reason: 'startTimeReached' };
    }

    if (present === null) {
        // EIT[p/f] がまだ読めていない。上限を過ぎたら開始する
        return input.elapsedMs >= input.config.timeoutMs
            ? { canStart: true, reason: input.eventId === null ? 'timeout' : 'eitSoftTimeout' }
            : { canStart: false, reason: 'waitingForEit' };
    }

    // programId 予約は eventId で厳密に判断できる
    if (input.eventId !== null) {
        if (present.eventId === input.eventId) {
            return { canStart: true, reason: 'eventMatched' };
        }

        // present 更新前でも対象 following の開始時刻に到達したら開始する。
        // 開始マージンが設定されていればその分だけ前倒しする。
        if (
            following !== null &&
            following.eventId === input.eventId &&
            following.startAt !== null &&
            input.currentAt !== undefined &&
            input.currentAt >= following.startAt - (input.recordingStartMarginMs ?? 0)
        ) {
            return { canStart: true, reason: 'followingTimeReached' };
        }

        // 別 event_id のまま固着した場合は hard timeout で全損を避ける。
        if (input.elapsedMs >= input.config.hardTimeoutMs) {
            return { canStart: true, reason: 'eitHardTimeout' };
        }

        // programId 予約は eventId が一致しない限り通常は開始しない。
        // ただし EIT 異常で全損しないよう hardTimeoutMs の安全弁を上で適用する。
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
        if (
            input.currentAt !== undefined &&
            input.recordingStartMarginMs !== undefined &&
            input.currentAt < input.reserveStartAt - input.recordingStartMarginMs
        ) {
            return { canStart: false, reason: 'waitingForStartMargin' };
        }
        return { canStart: true, reason: 'startTimeReached' };
    }

    return decidePreviousProgram(present, input);
};
