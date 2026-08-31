import { StreamPreset } from '../model/stream/preset/IStreamPreset';
import { SourceCapabilities } from '../model/stream/capability/ISourceCapabilities';
import { VideoCorrectionMode } from '../model/stream/preset/IStreamPreset';
import { getVideoCorrectionFilter } from './VideoCorrectionUtil';

export type StreamEncoderKind = 'nvencc' | 'qsvencc' | 'vceencc' | 'ffmpeg';

export interface StreamEncoderCapability {
    kind: StreamEncoderKind;
    command?: string;
    codecs: Array<'h264' | 'hevc'>;
    bitDepths: number[];
    hdr?: boolean;
}

export type StreamBuilderMode = 'live' | 'recorded';

const encoderSelectionCache = new Map<string, { expiresAt: number; encoder: StreamEncoderCapability }>();
export const ENCODER_CAPABILITY_CACHE_TTL_MS = 60_000;

const FPS = (value: number): string | null => {
    if (Math.abs(value - 59.94) < 0.01) return '60000/1001';
    if (Math.abs(value - 29.97) < 0.01) return '30000/1001';
    if (Number.isInteger(value)) return String(value);
    return String(value);
};

/** 配信出力の要求ビット深度を解決する。 */
export const outputBitDepth = (source: SourceCapabilities, preset: StreamPreset): number =>
    isToneMapping(source, preset) || preset.output.bitDepth === 'source' || preset.output.bitDepth === undefined
        ? isToneMapping(source, preset)
            ? 8
            : (source.bitDepth ?? 8)
        : preset.output.bitDepth;

const isToneMapping = (source: SourceCapabilities, preset: StreamPreset): boolean =>
    (preset.output.hdrMode === 'tone-map' || preset.output.hdrMode === 'sdr') &&
    (source.hdr === 'hlg' || source.hdr === 'pq');

const correctionMode = (preset: StreamPreset): VideoCorrectionMode => preset.output.videoCorrection ?? 'auto';

const toneMapFilter = (source: SourceCapabilities, preset: StreamPreset): string[] => {
    if (!isToneMapping(source, preset)) return [];
    // 色域・伝達特性を SDR 化してから scale。BT.709 の画素を解像度変換するため、
    // HDR のまま scale して補間した値をトーンマップするより意図した色を保ちやすい。
    return ['zscale=t=linear:npl=100', 'tonemap=hable:desat=0', 'zscale=p=bt709:t=bt709:m=bt709'];
};

/** source と preset の映像補正フィルタを返す。 */
export const videoCorrectionFilter = (
    source: SourceCapabilities,
    preset: StreamPreset,
    mode?: StreamBuilderMode,
): string | null =>
    getVideoCorrectionFilter(source, correctionMode(preset), {
        hdrMode: preset.output.hdrMode,
        live: mode === 'live',
    });

/** source.scan と deinterlace 設定からデインターレース方式を解決する。 */
export const deinterlaceMode = (source: SourceCapabilities, preset: StreamPreset): 'off' | 'normal' | 'bob' => {
    const requested = preset.output.deinterlace ?? 'auto';
    const enabled =
        source.scan === 'interlaced' ||
        (source.scan === 'unknown' && requested === 'auto' && source.sourceClass === 'legacy-broadcast');
    if (!enabled || requested === 'off') return 'off';
    if (requested === '60p' || (requested === 'auto' && preset.output.frameRate === '60p')) return 'bob';
    return 'normal';
};

/** source fps をエンコーダ CLI の fps 表記へ変換する。 */
export const sourceFps = (source: SourceCapabilities): string | null =>
    source.frameRate === undefined ? null : FPS(source.frameRate);

const outputHeight = (source: SourceCapabilities, preset: StreamPreset): number | undefined => {
    switch (preset.output.resolution) {
        case '2160p':
            return 2160;
        case '1080p':
            return 1080;
        case '720p':
            return 720;
        case '480p':
            return 480;
        case '240p':
            return 240;
        case 'source':
        case undefined:
            return source.height;
    }
};

/** source と preset に合うエンコーダを TTL 付きで選ぶ。 */
export const selectEncoder = (
    source: SourceCapabilities,
    preset: StreamPreset,
    available: readonly StreamEncoderCapability[],
): StreamEncoderCapability => {
    const codec = preset.output.codec === 'copy' || preset.output.codec === undefined ? null : preset.output.codec;
    const depth = outputBitDepth(source, preset);
    const hdr = preset.output.hdrMode === 'preserve' && source.hdr !== 'sdr';
    const cacheKey = JSON.stringify({ sourceClass: source.sourceClass, codec, depth, hdr, available });
    const cached = encoderSelectionCache.get(cacheKey);
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.encoder;
    const candidates = available.filter(
        encoder =>
            (codec === null || encoder.codecs.includes(codec)) &&
            encoder.bitDepths.includes(depth) &&
            (!hdr || encoder.hdr === true),
    );
    if (candidates.length === 0) {
        throw new Error(`No available encoder supports codec=${codec ?? 'copy'}, bitDepth=${depth}, hdr=${hdr}`);
    }
    // 入力順を優先順位とは解釈しない。能力が最も近いものを選び、同点時だけ安定した名前で決める。
    const selected = [...candidates].sort((a, b) => {
        const score = (item: StreamEncoderCapability): number =>
            (item.kind === 'ffmpeg' ? 0 : 1) + (item.codecs.includes(codec ?? 'h264') ? 2 : 0);
        return score(b) - score(a) || a.kind.localeCompare(b.kind);
    })[0];
    encoderSelectionCache.set(cacheKey, { expiresAt: Date.now() + ENCODER_CAPABILITY_CACHE_TTL_MS, encoder: selected });
    return selected;
};

/** common ffmpeg filter arguments. Progressive source never receives deinterlace filters. */
export const buildFfmpegVideoFilter = (
    source: SourceCapabilities,
    preset: StreamPreset,
    height?: number,
): string | null => {
    const parts: string[] = [];
    const deint = deinterlaceMode(source, preset);
    if (deint !== 'off') parts.push(`yadif=${deint === 'bob' ? '1' : '0'}`);
    parts.push(...toneMapFilter(source, preset));
    if (height !== undefined && source.height !== height) parts.push(`scale=-2:${height}`);
    const correction = videoCorrectionFilter(source, preset);
    if (correction !== null) parts.push(correction);
    if (isToneMapping(source, preset)) parts.push('format=yuv420p');
    else if (outputBitDepth(source, preset) >= 10) parts.push('format=yuv420p10le');
    return parts.length > 0 ? parts.join(',') : null;
};

/** rigaya の映像引数を組み立てる。 */
export const buildRigayaVideoArgs = (
    source: SourceCapabilities,
    preset: StreamPreset,
    encoder: StreamEncoderCapability,
    mode: StreamBuilderMode,
    isFileInput: boolean,
): string => {
    const codec = preset.output.codec === 'hevc' ? 'hevc' : 'h264';
    const height = outputHeight(source, preset);
    const depth = outputBitDepth(source, preset);
    const deint = deinterlaceMode(source, preset);
    const field = source.fieldOrder === 'bff' ? 'bff' : 'tff';
    const tuning = mode === 'live' ? '--preset P3 --bframes 0 --lowlatency' : '--preset P5 --bframes 2 --lookahead 20';
    const deintArgs =
        deint === 'off'
            ? ''
            : ` --interlace ${field} ${encoder.kind === 'vceencc' ? '--vpp-yadif' : `--vpp-deinterlace ${deint}`}`;
    const fps =
        preset.output.frameRate === 'source' || preset.output.frameRate === undefined
            ? sourceFps(source)
            : preset.output.frameRate === '60p'
              ? '60000/1001'
              : '30000/1001';
    const sync = isFileInput
        ? ` --avsync forcecfr${fps ? ` --fps ${fps}` : source.sourceClass === 'legacy-broadcast' ? ' --fps 30000/1001' : ''}`
        : '';
    const transfer = source.transfer === 'pq' ? 'smpte2084' : source.transfer === 'hlg' ? 'arib-std-b67' : 'bt709';
    const hdr =
        preset.output.hdrMode === 'preserve' && source.hdr !== 'sdr'
            ? ` --colorprim bt2020 --transfer ${transfer} --colormatrix bt2020nc`
            : isToneMapping(source, preset)
              ? ' --colorprim bt709 --transfer bt709 --colormatrix bt709'
              : '';
    const toneMap = isToneMapping(source, preset) ? ' --vpp-colorspace hdr2sdr=hable' : '';
    return `-c ${codec} --profile ${depth >= 10 ? 'main10' : 'main'} --output-depth ${depth} ${tuning}${deintArgs}${toneMap}${height ? ` --output-res -2x${height}` : ''}${hdr}${sync}`;
};

/** source/output に対応する ffmpeg の映像引数を組み立てる。 */
export const buildFfmpegVideoArgs = (
    source: SourceCapabilities,
    preset: StreamPreset,
    mode: StreamBuilderMode,
): string => {
    const codec = preset.output.codec === 'hevc' ? 'libx265' : 'libx264';
    const height = outputHeight(source, preset);
    const depth = outputBitDepth(source, preset);
    const filter = buildFfmpegVideoFilter(source, preset, height);
    const transfer = source.transfer === 'pq' ? 'smpte2084' : source.transfer === 'hlg' ? 'arib-std-b67' : 'bt709';
    const hdr =
        preset.output.hdrMode === 'preserve' && source.hdr !== 'sdr'
            ? ` -color_primaries bt2020 -color_trc ${transfer} -colorspace bt2020nc`
            : isToneMapping(source, preset)
              ? ' -color_primaries bt709 -color_trc bt709 -colorspace bt709'
              : '';
    const profile = depth >= 10 ? ' -profile:v main10 -pix_fmt yuv420p10le' : '';
    const tuning =
        mode === 'live'
            ? ' -preset veryfast -tune zerolatency -bf 0'
            : ' -preset faster -bf 2 -aq-mode 2 -look_ahead 20';
    const fps =
        preset.output.frameRate === 'source' || preset.output.frameRate === undefined
            ? sourceFps(source)
            : preset.output.frameRate === '60p'
              ? '60000/1001'
              : '30000/1001';
    return `-c:v ${codec}${filter ? ` -vf ${filter}` : ''}${profile}${tuning}${fps ? ` -r ${fps}` : ''}${hdr}${codec === 'libx265' ? ' -tag:v hvc1' : ''}`;
};
