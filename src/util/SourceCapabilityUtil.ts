import {
    SourceCapabilities,
    VideoCodecKind,
    ScanType,
    HdrKind,
    ColorPrimaries,
    TransferKind,
} from '../model/stream/capability/ISourceCapabilities';

export interface FfprobeVideoStream {
    codec_name?: string;
    width?: number;
    height?: number;
    pix_fmt?: string;
    bits_per_raw_sample?: string | number;
    field_order?: string;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    color_transfer?: string;
    color_primaries?: string;
}

const parsePositiveNumber = (value: string | number | undefined): number | undefined => {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
};

const parseFrameRate = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined;
    const [numerator, denominator] = value.split('/').map(Number);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0 || numerator === 0) {
        return undefined;
    }
    return numerator / denominator;
};

const getBitDepth = (stream: FfprobeVideoStream): 8 | 10 | 12 | undefined => {
    const explicit = parsePositiveNumber(stream.bits_per_raw_sample);
    if (explicit === 8 || explicit === 10 || explicit === 12) return explicit;
    const pixelFormat = stream.pix_fmt?.toLowerCase() ?? '';
    if (/(?:p012|yuv(?:420|422|444)p?12(?:le|be)?)/.test(pixelFormat)) return 12;
    if (/(?:p010|yuv(?:420|422|444)p?10(?:le|be)?)/.test(pixelFormat)) return 10;
    if (/(?:nv12|yuv(?:420|422|444)p)/.test(pixelFormat)) return 8;
    return undefined;
};

const getScan = (fieldOrder: string | undefined): { scan: ScanType; fieldOrder?: 'tff' | 'bff' | 'unknown' } => {
    switch (fieldOrder?.toLowerCase()) {
        case 'tt':
        case 'tb':
            return { scan: 'interlaced', fieldOrder: 'tff' };
        case 'bb':
        case 'bt':
            return { scan: 'interlaced', fieldOrder: 'bff' };
        case 'progressive':
            return { scan: 'progressive' };
        default:
            return { scan: 'unknown' };
    }
};

const getTransfer = (value: string | undefined): { hdr: HdrKind; transfer: TransferKind } => {
    switch (value?.toLowerCase()) {
        case 'arib-std-b67':
            return { hdr: 'hlg', transfer: 'hlg' };
        case 'smpte2084':
            return { hdr: 'pq', transfer: 'pq' };
        case 'bt709':
            return { hdr: 'sdr', transfer: 'bt709' };
        case 'smpte170m':
        case 'smpte240m':
        case 'bt470bg':
        case 'gamma22':
        case 'gamma28':
        case 'iec61966-2-1':
            return { hdr: 'sdr', transfer: 'bt709' };
        default:
            return { hdr: 'unknown', transfer: 'unknown' };
    }
};

const getPrimaries = (value: string | undefined): ColorPrimaries | undefined => {
    const normalized = value?.toLowerCase();
    if (normalized?.startsWith('bt2020')) return 'bt2020';
    if (normalized === 'bt709') return 'bt709';
    return normalized === undefined ? undefined : 'unknown';
};

const getCodec = (value: string | undefined): VideoCodecKind => {
    switch (value?.toLowerCase()) {
        case 'mpeg2video':
            return 'mpeg2';
        case 'h264':
            return 'h264';
        case 'hevc':
            return 'hevc';
        case 'av1':
            return 'av1';
        default:
            return 'unknown';
    }
};

/** ffprobe の映像 stream 情報を SourceCapabilities へ変換する。 */
export const toSourceCapabilities = (stream: FfprobeVideoStream): SourceCapabilities => {
    const scan = getScan(stream.field_order);
    const transfer = getTransfer(stream.color_transfer);
    const frameRate = parseFrameRate(stream.avg_frame_rate) ?? parseFrameRate(stream.r_frame_rate);
    const values = [
        stream.codec_name,
        stream.width,
        stream.height,
        getBitDepth(stream),
        stream.field_order,
        frameRate,
        stream.color_transfer,
        stream.color_primaries,
    ].filter(value => value !== undefined).length;

    return {
        codec: getCodec(stream.codec_name),
        width: stream.width,
        height: stream.height,
        bitDepth: getBitDepth(stream),
        scan: scan.scan,
        frameRate,
        fieldOrder: scan.fieldOrder,
        colorPrimaries: getPrimaries(stream.color_primaries),
        transfer: transfer.transfer,
        hdr: transfer.hdr,
        sourceClass: 'unknown',
        confidence: values >= 7 ? 'high' : values >= 4 ? 'medium' : 'low',
    };
};

export default toSourceCapabilities;
