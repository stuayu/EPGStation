/**
 * ブラウザーから採取した再生停滞の観測値。
 * `at` は単調な経過時間ではなく、同じ時計で比較できるミリ秒値。
 */
export interface PlaybackStallSample {
    at: number;
    currentTime: number;
    bufferedEnd: number | null;
    playing: boolean;
    event: 'waiting' | 'timeupdate' | 'poll';
}

export interface PlaybackStallDecision {
    shouldFallback: boolean;
    reason: 'repeated-waiting' | 'no-progress' | null;
}

export interface PlaybackStallDetectorOptions {
    windowMs?: number;
    waitingCount?: number;
    noProgressMs?: number;
    progressEpsilonSec?: number;
    lowBufferSec?: number;
}

/**
 * Resource Timing API から得た配信データの取得実績。
 */
export interface PlaybackThroughputSample {
    at: number;
    bytes: number;
    durationMs: number;
}

/**
 * 実効帯域から選んだ fallback の結果。
 */
export interface PlaybackThroughputDecision {
    profileId: string | null;
    bandwidthKbps: number | null;
}

/**
 * 自動画質 fallback を実行してよい状態か返す。
 * 明示画質 (autoPlayback=false) は、停滞が検出されてもユーザー選択を上書きしない。
 * @param autoPlayback: boolean おまかせ選択中か
 * @param isNormalVideo: boolean ファイル直接再生か
 * @return boolean
 */
export const canAutoFallback = (autoPlayback: boolean, isNormalVideo: boolean): boolean =>
    autoPlayback === true && isNormalVideo === false;

export interface ThroughputProfile {
    id: string;
    videoBitrate?: number;
}

/**
 * 現在の映像 bitrate を、観測した帯域で安全に維持できるか判定する。
 * 停滞中でも帯域が十分なら、回線ではなく配信側のエンコード遅延を疑う材料になる。
 * @param currentId: string 現在のプリセット識別子
 * @param profiles: ThroughputProfile[] プリセットと映像 bitrate
 * @param samples: PlaybackThroughputSample[] 取得実績
 * @param now: number 判定時刻 (ms)
 * @param safetyFactor: number 帯域に対する安全率
 * @return boolean
 */
export const isPlaybackThroughputSufficient = (
    currentId: string,
    profiles: readonly ThroughputProfile[],
    samples: readonly PlaybackThroughputSample[],
    now: number,
    safetyFactor = 0.75,
): boolean => {
    if (safetyFactor <= 0 || safetyFactor > 1) return false;

    const bandwidthKbps = estimatePlaybackBandwidthKbps(samples, now);
    const currentBitrate = profiles.find(profile => profile.id === currentId)?.videoBitrate;

    return (
        bandwidthKbps !== null && typeof currentBitrate === 'number' && bandwidthKbps * safetyFactor >= currentBitrate
    );
};

const DEFAULT_OPTIONS: Required<PlaybackStallDetectorOptions> = {
    // 30 秒は、ライブの通常のパート境界待ちを単発の回線揺らぎと分離する観測窓。
    windowMs: 30_000,
    // 直近30秒で3回 waiting なら、回線不足の候補とする。
    waitingCount: 3,
    // 5秒間 currentTime がほぼ進まない状態は、バッファ枯渇の実測根拠とする。
    noProgressMs: 5_000,
    progressEpsilonSec: 0.25,
    // waiting 時、または停滞中に残っているバッファが1秒以下なら回線不足とみなす。
    lowBufferSec: 1,
};

/**
 * 再生観測列から、現在の画質では回線が不足しているかを判定する。
 * シーク・画質切替・タブ復帰の抑制は呼び出し側で行い、この関数は時計と観測値だけを扱う。
 * @param samples: PlaybackStallSample[] 観測列
 * @param now: number 判定時刻 (ms)
 * @param options: PlaybackStallDetectorOptions 判定閾値
 * @return PlaybackStallDecision
 */
export const detectPlaybackStall = (
    samples: readonly PlaybackStallSample[],
    now: number,
    options: PlaybackStallDetectorOptions = {},
): PlaybackStallDecision => {
    const config = { ...DEFAULT_OPTIONS, ...options };
    const recent = samples
        .filter(sample => Number.isFinite(sample.at) && sample.at >= now - config.windowMs && sample.at <= now)
        .sort((a, b) => a.at - b.at);
    if (recent.length === 0) {
        return { shouldFallback: false, reason: null };
    }

    const latest = recent[recent.length - 1];
    const waitingSamples = recent.filter(sample => sample.event === 'waiting' && sample.playing === true);
    const hasLowBuffer = (sample: PlaybackStallSample): boolean =>
        sample.bufferedEnd === null || sample.bufferedEnd - sample.currentTime <= config.lowBufferSec;
    if (waitingSamples.length >= config.waitingCount && hasLowBuffer(latest)) {
        return { shouldFallback: true, reason: 'repeated-waiting' };
    }

    for (const start of recent) {
        if (
            latest.at - start.at >= config.noProgressMs &&
            Math.abs(latest.currentTime - start.currentTime) <= config.progressEpsilonSec &&
            latest.playing === true &&
            hasLowBuffer(latest)
        ) {
            return { shouldFallback: true, reason: 'no-progress' };
        }
    }

    return { shouldFallback: false, reason: null };
};

/**
 * Resource Timing の直近サンプルから実効帯域を中央値で推定する。
 * 外れ値 1 件で fallback 先が飛ばないようにし、複数サンプルが揃わない場合は null を返す。
 * @param samples: PlaybackThroughputSample[] 取得実績
 * @param now: number 判定時刻 (ms)
 * @param windowMs: number 観測窓 (ms)
 * @return number | null kbps
 */
export const estimatePlaybackBandwidthKbps = (
    samples: readonly PlaybackThroughputSample[],
    now: number,
    windowMs = 30_000,
): number | null => {
    const rates = samples
        .filter(
            sample =>
                Number.isFinite(sample.at) &&
                sample.at >= now - windowMs &&
                sample.at <= now &&
                Number.isFinite(sample.bytes) &&
                sample.bytes > 0 &&
                Number.isFinite(sample.durationMs) &&
                sample.durationMs >= 100,
        )
        .map(sample => (sample.bytes * 8) / sample.durationMs)
        .sort((a, b) => a - b);
    if (rates.length < 2) return null;

    const middle = Math.floor(rates.length / 2);
    const rateMbps = rates.length % 2 === 0 ? (rates[middle - 1] + rates[middle]) / 2 : rates[middle];

    return rateMbps;
};

/**
 * 実効帯域に収まる fallback 候補を一度に選ぶ。
 * bitrate が未提供の候補は安全側の直接選択に使わず、呼び出し側の1段降格へ戻す。
 * @param currentId: string 現在のプリセット識別子
 * @param fallbackChain: string[] 低負荷順の fallback 候補
 * @param profiles: ThroughputProfile[] プリセットと映像 bitrate
 * @param samples: PlaybackThroughputSample[] 取得実績
 * @param now: number 判定時刻 (ms)
 * @param safetyFactor: number 帯域に対する bitrate の安全率
 * @return PlaybackThroughputDecision
 */
export const selectThroughputFallback = (
    currentId: string,
    fallbackChain: readonly string[],
    profiles: readonly ThroughputProfile[],
    samples: readonly PlaybackThroughputSample[],
    now: number,
    safetyFactor = 0.75,
): PlaybackThroughputDecision => {
    const bandwidthKbps = estimatePlaybackBandwidthKbps(samples, now);
    if (bandwidthKbps === null || safetyFactor <= 0 || safetyFactor > 1) {
        return { profileId: null, bandwidthKbps };
    }

    const current = profiles.find(profile => profile.id === currentId);
    const currentBitrate = current?.videoBitrate;
    const candidates = fallbackChain
        .map(id => profiles.find(profile => profile.id === id))
        .filter(
            (profile): profile is ThroughputProfile =>
                profile !== undefined && typeof profile.videoBitrate === 'number',
        );
    if (candidates.length === 0 || typeof currentBitrate !== 'number') {
        return { profileId: null, bandwidthKbps };
    }

    const maxBitrate = bandwidthKbps * safetyFactor;
    const lower = candidates.filter(profile => (profile.videoBitrate as number) < currentBitrate);
    if (lower.length === 0) return { profileId: null, bandwidthKbps };

    // 収まる中で最も高い画質を選ぶ。1つも収まらない場合は最低 bitrate へ直接落とす。
    const selected =
        [...lower]
            .filter(profile => (profile.videoBitrate as number) <= maxBitrate)
            .sort((a, b) => (b.videoBitrate as number) - (a.videoBitrate as number))[0] ??
        [...lower].sort((a, b) => (a.videoBitrate as number) - (b.videoBitrate as number))[0];

    return { profileId: selected?.id ?? null, bandwidthKbps };
};
