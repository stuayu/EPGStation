/**
 * 実機計測ハーネスが採取した再生状態。
 */
export interface PlaybackHarnessSample {
    at: number;
    currentTime: number;
    paused: boolean;
}

export interface PlaybackStallSummary {
    stopCount: number;
    maxStallSeconds: number;
    totalStallSeconds: number;
}

export interface PlaybackStabilityOptions {
    progressEpsilonSeconds?: number;
    maxStops?: number;
    maxStallSeconds?: number;
    minProgressSeconds?: number;
}

export interface PlaybackStabilityResult {
    passed: boolean;
    summary: PlaybackStallSummary;
    reason: string | null;
}

/**
 * 再生中に currentTime が進まなかった区間を集計する。
 * @param samples: PlaybackHarnessSample[] 採取値
 * @param progressEpsilonSeconds: number 進行とみなす最小差分
 * @return PlaybackStallSummary
 */
export const summarizePlaybackStalls = (
    samples: readonly PlaybackHarnessSample[],
    progressEpsilonSeconds = 0.05,
): PlaybackStallSummary => {
    const ordered = [...samples].sort((a, b) => a.at - b.at);
    let stopCount = 0;
    let maxStallSeconds = 0;
    let totalStallSeconds = 0;
    let currentStallSeconds = 0;
    let inStall = false;

    for (let index = 1; index < ordered.length; index += 1) {
        const previous = ordered[index - 1];
        const current = ordered[index];
        const stagnant =
            previous.paused === false &&
            current.paused === false &&
            Math.abs(current.currentTime - previous.currentTime) <= progressEpsilonSeconds;
        const elapsedSeconds = Math.max(0, (current.at - previous.at) / 1000);

        if (stagnant) {
            if (inStall === false) stopCount += 1;
            inStall = true;
            currentStallSeconds += elapsedSeconds;
            maxStallSeconds = Math.max(maxStallSeconds, currentStallSeconds);
            totalStallSeconds += elapsedSeconds;
        } else {
            inStall = false;
            currentStallSeconds = 0;
        }
    }

    return {
        stopCount,
        maxStallSeconds: Number(maxStallSeconds.toFixed(3)),
        totalStallSeconds: Number(totalStallSeconds.toFixed(3)),
    };
};

/**
 * 停止回数・最長停止・最低再生進行量で実測結果を合否判定する。
 * @param samples: PlaybackHarnessSample[] 採取値
 * @param options: PlaybackStabilityOptions 判定閾値
 * @return PlaybackStabilityResult
 */
export const evaluatePlaybackStability = (
    samples: readonly PlaybackHarnessSample[],
    options: PlaybackStabilityOptions = {},
): PlaybackStabilityResult => {
    const progressEpsilonSeconds = options.progressEpsilonSeconds ?? 0.05;
    const summary = summarizePlaybackStalls(samples, progressEpsilonSeconds);
    const maxStops = options.maxStops ?? 0;
    const maxStallSeconds = options.maxStallSeconds ?? 0;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const progressSeconds = first === undefined || last === undefined ? 0 : Math.max(0, last.currentTime - first.currentTime);
    const minProgressSeconds = options.minProgressSeconds ?? 0;

    if (summary.stopCount > maxStops) {
        return { passed: false, summary, reason: `停止回数 ${summary.stopCount} > ${maxStops}` };
    }
    if (summary.maxStallSeconds > maxStallSeconds) {
        return { passed: false, summary, reason: `最長停止 ${summary.maxStallSeconds}s > ${maxStallSeconds}s` };
    }
    if (progressSeconds < minProgressSeconds) {
        return { passed: false, summary, reason: `再生進行 ${progressSeconds.toFixed(3)}s < ${minProgressSeconds}s` };
    }

    return { passed: true, summary, reason: null };
};

/**
 * DPlayer 時刻表示を秒へ変換する。
 * @param value: string 時刻表示
 * @return number | null
 */
export const parsePlaybackTime = (value: string): number | null => {
    const match = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
    if (match === null) return null;
    const first = Number(match[1]);
    const second = Number(match[2]);
    const third = match[3] === undefined ? null : Number(match[3]);
    return third === null ? first * 60 + second : first * 3600 + second * 60 + third;
};

export interface JikkyoSample {
    positionText: string;
    texts: readonly string[];
}

export interface JikkyoMatch {
    text: string;
    positionSeconds: number;
    expectedAtMs: number;
    actualAtMs: number;
    driftSeconds: number;
}

/**
 * 表示中の実況本文を過去ログ時刻へ突き合わせる。
 * @param samples: JikkyoSample[] 表示観測値
 * @param timesByText: Record<string, number[]> 本文ごとの実時刻
 * @param videoStartAtMs: number 録画先頭の実時刻
 * @return JikkyoMatch[] 突き合わせ結果
 */
export const matchJikkyoCommentTimes = (
    samples: readonly JikkyoSample[],
    timesByText: Readonly<Record<string, readonly number[]>>,
    videoStartAtMs: number,
): JikkyoMatch[] => {
    const matches: JikkyoMatch[] = [];
    for (const sample of samples) {
        const positionSeconds = parsePlaybackTime(sample.positionText);
        if (positionSeconds === null) continue;
        const expectedAtMs = videoStartAtMs + positionSeconds * 1000;
        for (const text of new Set(sample.texts)) {
            const candidates = timesByText[text];
            if (candidates === undefined || candidates.length === 0) continue;
            const actualAtMs = candidates.reduce((best, candidate) =>
                Math.abs(candidate - expectedAtMs) < Math.abs(best - expectedAtMs) ? candidate : best,
            );
            matches.push({
                text,
                positionSeconds,
                expectedAtMs,
                actualAtMs,
                driftSeconds: (actualAtMs - expectedAtMs) / 1000,
            });
        }
    }
    return matches;
};

export interface JikkyoSyncOptions {
    maxDriftSeconds?: number;
    minSamples?: number;
}

export interface JikkyoSyncResult {
    passed: boolean;
    sampleCount: number;
    maxAbsoluteDriftSeconds: number | null;
    reason: string | null;
}

/**
 * 実況同期の最大ずれをしきい値で判定する。
 * @param matches: JikkyoMatch[] 突き合わせ結果
 * @param options: JikkyoSyncOptions 判定閾値
 * @return JikkyoSyncResult
 */
export const evaluateJikkyoSync = (
    matches: readonly JikkyoMatch[],
    options: JikkyoSyncOptions = {},
): JikkyoSyncResult => {
    const maxDriftSeconds = options.maxDriftSeconds ?? 2;
    const minSamples = options.minSamples ?? 1;
    const maximum = matches.length === 0 ? null : Math.max(...matches.map(match => Math.abs(match.driftSeconds)));
    if (matches.length < minSamples) {
        return { passed: false, sampleCount: matches.length, maxAbsoluteDriftSeconds: maximum, reason: `標本数 ${matches.length} < ${minSamples}` };
    }
    if (maximum !== null && maximum > maxDriftSeconds) {
        return { passed: false, sampleCount: matches.length, maxAbsoluteDriftSeconds: maximum, reason: `最大ずれ ${maximum.toFixed(3)}s > ${maxDriftSeconds}s` };
    }
    return { passed: true, sampleCount: matches.length, maxAbsoluteDriftSeconds: maximum, reason: null };
};

export interface EmsgCoverageResult {
    passed: boolean;
    segmentCount: number;
    emsgCount: number;
    ratio: number;
    reason: string | null;
}

/**
 * セグメントごとの emsg 有無を集計する。
 * @param hasEmsg: boolean[] セグメント判定
 * @param minimumRatio: number 必要比率
 * @param minimumSegments: number 必要セグメント数
 * @return EmsgCoverageResult
 */
export const evaluateEmsgCoverage = (
    hasEmsg: readonly boolean[],
    minimumRatio = 1,
    minimumSegments = 1,
): EmsgCoverageResult => {
    const emsgCount = hasEmsg.filter(Boolean).length;
    const ratio = hasEmsg.length === 0 ? 0 : emsgCount / hasEmsg.length;
    if (hasEmsg.length < minimumSegments) {
        return { passed: false, segmentCount: hasEmsg.length, emsgCount, ratio, reason: `セグメント数 ${hasEmsg.length} < ${minimumSegments}` };
    }
    if (ratio < minimumRatio) {
        return { passed: false, segmentCount: hasEmsg.length, emsgCount, ratio, reason: `emsg 比率 ${ratio.toFixed(3)} < ${minimumRatio}` };
    }
    return { passed: true, segmentCount: hasEmsg.length, emsgCount, ratio, reason: null };
};
