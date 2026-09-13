import type * as apid from '../../api';

/**
 * 配信方式の表示ラベル。
 * API のパス名とは異なるため、文字列の小文字化で変換してはいけない。
 */
export const STREAMING_TYPE_LABELS = ['M2TS', 'M2TS-LL', 'WebM', 'MP4', 'HLS'] as const;
export type StreamingTypeLabel = (typeof STREAMING_TYPE_LABELS)[number];

/** 録画配信ダイアログで表示する配信方式のラベル一覧。 */
export const RECORDED_STREAM_TYPE_LABELS = ['WebM', 'MP4', 'HLS', 'M2TS-LL'] as const;
export type RecordedStreamType = (typeof RECORDED_STREAM_TYPE_LABELS)[number];

/** 録画配信 API が受け付けるパス名一覧。 */
export const RECORDED_STREAMING_TYPES = ['webm', 'mp4', 'hls', 'm2tsll'] as const;
export type RecordedStreamingType = (typeof RECORDED_STREAMING_TYPES)[number];

export type StreamingType = Exclude<apid.PlaybackContainer, 'normal'>;

/** ライブ・録画配信 API が受け付けるパス名一覧。 */
export const STREAMING_TYPES = ['m2ts', 'm2tsll', 'mp4', 'webm', 'hls'] as const satisfies readonly StreamingType[];

const STREAMING_TYPE_PATHS: Readonly<Record<StreamingTypeLabel, StreamingType>> = {
    M2TS: 'm2ts',
    'M2TS-LL': 'm2tsll',
    WebM: 'webm',
    MP4: 'mp4',
    HLS: 'hls',
};

/**
 * 配信方式の表示ラベルを API のパス名へ変換する。
 * @param label: StreamingTypeLabel 配信方式の表示ラベル
 * @return StreamingType API が受け付ける配信方式のパス名
 */
export const toStreamingType = (label: StreamingTypeLabel): StreamingType => STREAMING_TYPE_PATHS[label];

/** URL query のライブ配信方式を検証する。
 * @param value: unknown URL query の値
 * @return StreamingType 許可された配信方式。不明な値は null
 */
export const parseStreamingType = (value: unknown): StreamingType | null => {
    if (typeof value !== 'string') return null;

    return (STREAMING_TYPES as readonly string[]).includes(value) ? (value as StreamingType) : null;
};

/**
 * URL query の録画配信方式を検証する。
 * @param value: unknown URL query の値
 * @return RecordedStreamingType 許可された配信方式。不明な値は null
 */
export const parseRecordedStreamingType = (value: unknown): RecordedStreamingType | null => {
    if (typeof value !== 'string') return null;

    return (RECORDED_STREAMING_TYPES as readonly string[]).includes(value) ? (value as RecordedStreamingType) : null;
};
