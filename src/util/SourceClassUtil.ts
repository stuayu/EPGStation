import { SourceCapabilities, SourceClass } from '../model/stream/capability/ISourceCapabilities';

const legacyChannelTypes = new Set([
    'GR', 'BS', 'CS', 'SKY',
    ...Array.from({ length: 40 }, (_, index) => `NW${index + 1}`),
]);

/** 映像特性と任意のチャンネル種別から入力映像の分類を決める。 */
export const classifySource = (capabilities: SourceCapabilities, channelType?: string): SourceClass => {
    if (channelType === 'BS4K' || channelType === 'CS4K') return 'bs4k';
    if (channelType !== undefined && legacyChannelTypes.has(channelType)) return 'legacy-broadcast';
    if (capabilities.codec === 'hevc' && capabilities.bitDepth === 10
        && (capabilities.hdr === 'hlg' || capabilities.colorPrimaries === 'bt2020')
        && capabilities.height !== undefined && capabilities.height >= 2160) {
        return 'bs4k';
    }
    if (capabilities.codec === 'mpeg2' && capabilities.scan === 'interlaced'
        && capabilities.height !== undefined && capabilities.height <= 1080) {
        return 'legacy-broadcast';
    }
    return 'generic';
};

export default classifySource;
