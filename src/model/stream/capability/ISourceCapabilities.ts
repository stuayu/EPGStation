/**
 * 映像の搬送方式。
 */
export type VideoTransport = 'mpegts' | 'mmt-tlv' | 'mp4' | 'other';

/**
 * 映像コーデックの種別。
 */
export type VideoCodecKind = 'mpeg2' | 'h264' | 'hevc' | 'av1' | 'unknown';

/**
 * 映像の走査方式。
 */
export type ScanType = 'interlaced' | 'progressive' | 'unknown';

/**
 * 色域の原色。
 */
export type ColorPrimaries = 'bt709' | 'bt2020' | 'unknown';

/**
 * 転送特性。
 */
export type TransferKind = 'bt709' | 'hlg' | 'pq' | 'unknown';

/**
 * HDR の種別。
 */
export type HdrKind = 'sdr' | 'hlg' | 'pq' | 'unknown';

/**
 * 入力映像の分類。
 */
export type SourceClass = 'legacy-broadcast' | 'bs4k' | 'generic' | 'unknown';

/**
 * 入力映像の能力情報。
 */
export interface SourceCapabilities {
    /** 搬送方式。 */
    transport?: VideoTransport;
    /** 映像コーデック。 */
    codec: VideoCodecKind;
    /** 映像幅。 */
    width?: number;
    /** 映像高さ。 */
    height?: number;
    /** ビット深度。 */
    bitDepth?: 8 | 10 | 12;
    /** 走査方式。 */
    scan: ScanType;
    /** 実測フレームレート。 */
    frameRate?: number;
    /** フィールド順。 */
    fieldOrder?: 'tff' | 'bff' | 'unknown';
    /** 原色。 */
    colorPrimaries?: ColorPrimaries;
    /** 転送特性。 */
    transfer?: TransferKind;
    /** HDR 種別。 */
    hdr: HdrKind;
    /** 入力映像の分類。 */
    sourceClass: SourceClass;
    /** 解析結果の確からしさ。 */
    confidence: 'high' | 'medium' | 'low';
}
