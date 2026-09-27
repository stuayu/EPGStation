import { SourceCapabilities } from '../model/stream/capability/ISourceCapabilities';

export const TONEMAP_PLACEHOLDER = '%TONEMAP%';
export const HDR_TO_SDR_FILTER = 'zscale=t=linear:npl=100,tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709';
export const BT2020_TO_BT709_FILTER = 'colorspace=all=bt709:iall=bt2020:itrc=bt2020-10:fast=0:format=yuv420p';

export const bt2020ToBt709Filter = (source?: SourceCapabilities): string => {
    const transfer = source?.transferName ?? source?.transfer;
    // HLG は SDR 互換表示用に BT.2020 SDR (bt2020-10) として扱う。HLG に tone-map を掛けない。
    const inputTransfer = transfer === 'arib-std-b67' || transfer === 'hlg' || transfer === undefined || transfer === 'unknown'
        ? 'bt2020-10'
        : transfer === 'smpte2084' || transfer === 'pq' ? 'bt2020-10' : transfer;
    return `colorspace=all=bt709:iall=bt2020:itrc=${inputTransfer}:fast=0:format=yuv420p`;
};

export type ColorConversion = 'none' | 'bt2020-sdr-compatible' | 'pq-tonemap' | 'pq-sdr-compatible';

export const colorConversionFor = (source: SourceCapabilities | undefined, outputBitDepth: number): ColorConversion => {
    if (source === undefined || outputBitDepth >= 10) return 'none';
    const transfer = source.transferName ?? source.transfer;
    if (transfer === 'smpte2084' || source.hdr === 'pq') return 'pq-tonemap';
    if (transfer === 'arib-std-b67' || source.hdr === 'hlg') return 'bt2020-sdr-compatible';
    if (source.colorPrimaries === 'bt2020') return 'bt2020-sdr-compatible';
    return 'none';
};

export const colorConversionFilters = (source: SourceCapabilities | undefined, outputBitDepth: number, zscaleAvailable: boolean): string[] => {
    const conversion = colorConversionFor(source, outputBitDepth);
    if (conversion === 'none') return [];
    if (conversion === 'pq-tonemap' && zscaleAvailable) return HDR_TO_SDR_FILTER.split(',');
    return bt2020ToBt709Filter(source).split(',');
};

/** HDR 素材を8bit SDR出力へ変換する filter 部分を返す。 */
export const toneMapFilter = (source: SourceCapabilities): string[] => colorConversionFilters(source, 8, true);

/** 起動時に素材判定と ffmpeg filter の可用性で自動生成 cmd のトーンマップを解決する。 */
export const replaceToneMapPlaceholder = (
    cmd: string,
    source?: SourceCapabilities,
    filtersAvailable: boolean = true,
): string => {
    if (cmd.includes(TONEMAP_PLACEHOLDER) === false) return cmd;
    const conversion = colorConversionFor(source, 8);
    const isEightBitSdrOutput =
        /(?:h264|x264|avc|hevc|x265|265)/iu.test(cmd) &&
        (/-pix_fmt\s+yuv420p\b/u.test(cmd) || /format=nv12\b/u.test(cmd));
    if (conversion === 'none' || isEightBitSdrOutput === false) {
        const withoutFilter = cmd.replaceAll(`,${TONEMAP_PLACEHOLDER}`, '').replaceAll(`${TONEMAP_PLACEHOLDER},`, '').replaceAll(TONEMAP_PLACEHOLDER, '');
        return withoutFilter.replace(/-vf\s*(?=-|$)/gu, '');
    }
    const filter = conversion === 'pq-tonemap' && filtersAvailable
        ? HDR_TO_SDR_FILTER
        : bt2020ToBt709Filter(source);
    const converted = cmd.replaceAll(TONEMAP_PLACEHOLDER, filter);
    if (converted.includes(' -vf ') === false) return converted;
    const outputPosition = converted.lastIndexOf(' -f ');
    const tags = ' -color_primaries bt709 -color_trc bt709 -colorspace bt709';
    return outputPosition < 0
        ? `${converted}${tags}`
        : `${converted.slice(0, outputPosition)}${tags}${converted.slice(outputPosition)}`;
};
