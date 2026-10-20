export interface SilenceInterval {
    start: number;
    end: number;
}
export interface CmInterval {
    start: number;
    end: number;
}
export interface CmParameters {
    silenceNoiseDb: number;
    minSilenceSeconds: number;
    boundarySilenceSeconds: number;
    toleranceSeconds: number;
    minBlockSeconds: number;
    maxBlockSeconds: number;
}

export const CM_DETECT_PARAMETERS: Readonly<CmParameters> = {
    silenceNoiseDb: -50,
    minSilenceSeconds: 0.15,
    boundarySilenceSeconds: 0.8,
    toleranceSeconds: 0.6,
    minBlockSeconds: 30,
    maxBlockSeconds: 180,
};

/**
 * FFmpeg silencedetect のログから閉じた無音区間を抽出する。
 * @param output: string FFmpeg の標準エラー出力
 * @return SilenceInterval[] 開始・終了が確認できた無音区間
 */
export function parseSilenceDetectOutput(output: string): SilenceInterval[] {
    const result: SilenceInterval[] = [];
    let start: number | undefined;
    for (const line of output.split(/\r?\n/)) {
        const startMatch = line.match(/silence_start:\s*(-?[\d.]+)/);
        const endMatch = line.match(/silence_end:\s*(-?[\d.]+)/);
        if (startMatch) start = Number(startMatch[1]);
        if (endMatch && start !== undefined) {
            const end = Number(endMatch[1]);
            if (Number.isFinite(start) && Number.isFinite(end) && end >= start) result.push({ start, end });
            start = undefined;
        }
    }
    return result;
}

function isCommercialLength(seconds: number): boolean {
    return [15, 30, 60, 90, 120].some(unit => {
        const multiple = Math.round(seconds / unit);
        return multiple >= 1 && Math.abs(seconds - unit * multiple) <= CM_DETECT_PARAMETERS.toleranceSeconds + 0.000001;
    });
}

/**
 * 無音境界候補から、15 秒単位の CM 区間を推定する。
 * @param duration: number 動画の長さ (秒)
 * @param silences: SilenceInterval[] 検出した無音区間
 * @return CmInterval[] 推定した CM ブロック
 */
export function detectCmIntervals(duration: number, silences: SilenceInterval[]): CmInterval[] {
    if (!Number.isFinite(duration) || duration <= 0) return [];
    const boundaries = [
        0,
        ...silences
            .filter(s => s.end - s.start + 0.000001 >= CM_DETECT_PARAMETERS.boundarySilenceSeconds)
            .map(s => (s.start + s.end) / 2)
            .filter(t => t > 0 && t < duration),
        duration,
    ]
        .sort((a, b) => a - b)
        .filter((value, index, all) => index === 0 || value - all[index - 1] > 0.01);
    const intervals: CmInterval[] = [];
    let blockStart = -1;
    let blockEnd = -1;
    const flush = (): void => {
        const length = blockEnd - blockStart;
        if (
            blockStart >= 0 &&
            length + 0.000001 >= CM_DETECT_PARAMETERS.minBlockSeconds &&
            length <= CM_DETECT_PARAMETERS.maxBlockSeconds + 0.000001
        ) {
            intervals.push({ start: blockStart, end: blockEnd });
        }
        blockStart = -1;
        blockEnd = -1;
    };
    for (let i = 0; i < boundaries.length - 1; i++) {
        const start = boundaries[i];
        const end = boundaries[i + 1];
        const interior = start > 0 && end < duration;
        if (interior && isCommercialLength(end - start)) {
            if (blockStart < 0) blockStart = start;
            blockEnd = end;
            if (blockEnd - blockStart > CM_DETECT_PARAMETERS.maxBlockSeconds) flush();
        } else flush();
    }
    flush();
    return intervals;
}

/**
 * 推定 CM 区間を Ogg / Matroska simple chapter format へ変換する。
 * @param duration: number 動画の長さ (秒)
 * @param commercials: CmInterval[] CM 区間
 * @return string チャプターファイル内容
 */
export function createChapterText(duration: number, commercials: CmInterval[]): string {
    const points = [0, ...commercials.flatMap(cm => [cm.start, cm.end]), duration].sort((a, b) => a - b);
    const lines: string[] = [];
    for (let i = 0; i < points.length - 1; i++) {
        const start = points[i];
        const end = points[i + 1];
        if (end - start < 0.01) continue;
        const isCm = commercials.some(cm => start >= cm.start - 0.001 && end <= cm.end + 0.001);
        const n = lines.length / 2 + 1;
        const stamp = (value: number): string => {
            const ms = Math.round(value * 1000);
            const h = Math.floor(ms / 3600000);
            const m = Math.floor(ms / 60000) % 60;
            const s = Math.floor(ms / 1000) % 60;
            const milli = ms % 1000;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
        };
        lines.push(
            `CHAPTER${String(n).padStart(2, '0')}=${stamp(start)}`,
            `CHAPTER${String(n).padStart(2, '0')}NAME=${isCm ? 'CM' : '本編'}`,
        );
    }
    return `${lines.join('\n')}\n`;
}
