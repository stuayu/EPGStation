export interface VideoStartAtSources {
    /** TS の TDT/TOT と先頭 PTS から求めた時刻 */
    tsStartAt?: number | null;
    /** 同じ recorded に紐付く、元録画などの video_file.startAt */
    associatedStartAt?: number | null;
    /** 番組開始時刻 */
    recordedStartAt?: number | null;
    /** 予約開始より前に録画を始めた時間 */
    recordingStartMarginMs?: number | null;
    fileMtimeMs?: number | null;
    durationSec?: number | null;
}

const finite = (value: number | null | undefined): value is number =>
    typeof value === 'number' && Number.isFinite(value);

/**
 * 動画先頭の実時刻を推定する。
 * 根拠の優先順位は TS 内の放送時刻、紐付く元録画、番組開始時刻と録画開始マージン、
 * 最後にファイル更新日時と動画長。TS の既存 startAt 意味を保ち、encoded だけ推定誤差を減らす。
 * @param source: VideoStartAtSources
 * @return number | null UNIX 時刻 (ms)
 */
export const resolveVideoStartAt = (source: VideoStartAtSources): number | null => {
    if (finite(source.tsStartAt)) return Math.round(source.tsStartAt);
    if (finite(source.associatedStartAt)) return Math.round(source.associatedStartAt);
    if (finite(source.recordedStartAt)) {
        const margin = finite(source.recordingStartMarginMs) ? Math.max(0, source.recordingStartMarginMs) : 0;
        return Math.round(source.recordedStartAt - margin);
    }
    if (finite(source.fileMtimeMs) && finite(source.durationSec) && source.durationSec > 0) {
        return Math.round(source.fileMtimeMs - source.durationSec * 1000);
    }
    return null;
};

export default resolveVideoStartAt;
