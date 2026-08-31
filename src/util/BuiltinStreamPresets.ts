import { StreamPreset } from '../model/stream/preset/IStreamPreset';

/** Built-in と互換用 Legacy の配信プリセット。 */
export const BUILTIN_STREAM_PRESETS: readonly StreamPreset[] = [
    {
        id: 'auto',
        name: '自動・おすすめ',
        description: '再生環境と映像に合わせて選択',
        useFor: 'both',
        quality: 'highest',
        builtin: true,
        output: { codec: 'copy', resolution: 'source', bitDepth: 'source', hdrMode: 'preserve' },
    },
    {
        id: 'original',
        name: 'オリジナル',
        description: '元の映像をそのまま再生',
        useFor: 'both',
        quality: 'original',
        builtin: true,
        output: { codec: 'copy', resolution: 'source', bitDepth: 'source', frameRate: 'source', hdrMode: 'preserve' },
    },
    {
        id: '2160p-high',
        name: '4K 高画質',
        description: '4K映像を高画質で再生',
        detail: 'HEVC Main10 / 10bit / source fps / HDR preserve',
        useFor: 'both',
        quality: 'highest',
        builtin: true,
        sourceConditions: { minHeight: 2160, hdr: ['hlg', 'pq'] },
        clientConditions: { requireHevcMain10: true, requireHdr: true },
        output: { codec: 'hevc', resolution: '2160p', bitDepth: 10, frameRate: 'source', hdrMode: 'preserve' },
    },
    {
        id: '1080p-high',
        name: '1080p 高画質',
        description: 'フルHD映像を高画質で再生',
        detail: 'HEVC / 1080p',
        useFor: 'both',
        quality: 'high',
        builtin: true,
        clientConditions: { requireHevc: true },
        output: { codec: 'hevc', resolution: '1080p', bitDepth: 'source', hdrMode: 'sdr' },
    },
    {
        id: '1080p',
        name: '1080p 標準',
        description: 'フルHD映像を標準画質で再生',
        detail: 'H.264 or HEVC / 1080p / SDR',
        useFor: 'both',
        quality: 'balanced',
        builtin: true,
        output: { codec: 'h264', resolution: '1080p', bitDepth: 8, hdrMode: 'sdr' },
    },
    {
        id: '720p',
        name: '720p',
        description: '映像を軽くして再生',
        detail: 'H.264 / 720p / SDR',
        useFor: 'both',
        quality: 'balanced',
        builtin: true,
        output: { codec: 'h264', resolution: '720p', bitDepth: 8, hdrMode: 'sdr' },
    },
    {
        id: 'data-saver',
        name: 'データ節約',
        description: '通信量を抑えて再生',
        detail: 'H.264 / 480p / low bitrate / SDR',
        useFor: 'both',
        quality: 'compact',
        builtin: true,
        output: { codec: 'h264', resolution: '480p', bitDepth: 8, hdrMode: 'sdr', videoBitrate: 900, audioBitrate: 96 },
    },
];

const legacy = (
    id: string,
    name: string,
    container: StreamPreset['output']['container'],
    resolution: StreamPreset['output']['resolution'],
): StreamPreset => ({
    id,
    name,
    useFor: 'both',
    quality: 'balanced',
    builtin: false,
    legacy: true,
    output: { codec: resolution === 'source' ? 'copy' : 'h264', resolution, container },
});

/** 旧 config の表示・選択肢を失わないためのカタログ。 */
export const LEGACY_STREAM_PRESETS: readonly StreamPreset[] = [
    legacy('legacy-epgstation-720p', '720p', 'mp4', '720p'),
    legacy('legacy-epgstation-480p', '480p', 'mp4', '480p'),
    legacy('legacy-epgstation-hls-720p', 'HLS 720p', 'hls', '720p'),
    legacy('legacy-epgstation-hls-480p', 'HLS 480p', 'hls', '480p'),
    legacy('legacy-epgstation-mp4-720p', 'MP4 720p', 'mp4', '720p'),
    legacy('legacy-epgstation-mp4-480p', 'MP4 480p', 'mp4', '480p'),
    legacy('legacy-stuayu-2160p', '2160p', 'hls', '2160p'),
    legacy('legacy-stuayu-1080p', '1080p', 'hls', '1080p'),
    legacy('legacy-stuayu-720p', '720p', 'hls', '720p'),
    legacy('legacy-stuayu-480p', '480p', 'hls', '480p'),
    legacy('legacy-stuayu-240p', '240p', 'hls', '240p'),
];

export default BUILTIN_STREAM_PRESETS;
