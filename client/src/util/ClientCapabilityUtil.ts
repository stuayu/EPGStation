export type ClientCapabilities = {
    hevc: boolean;
    hevcMain10: boolean;
    h264: boolean;
    av1: boolean;
    hdr: boolean;
    hlg: boolean;
    screenWidth?: number;
    screenHeight?: number;
    hardwareDecode?: boolean;
    network: 'fast' | 'slow' | 'cellular' | 'unknown';
};

const CACHE_KEY = 'epgstation.playback.client-capabilities';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const canDecode = async (contentType: string, codec: string, hdr = false): Promise<boolean> => {
    const mediaCapabilities = (navigator as Navigator & { mediaCapabilities?: MediaCapabilities }).mediaCapabilities;
    if (mediaCapabilities !== undefined) {
        try {
            const result = await mediaCapabilities.decodingInfo({
                type: 'media-source',
                video: { contentType: `${contentType}; codecs="${codec}"`, width: 1920, height: 1080, bitrate: 8_000_000, framerate: 59.94, ...(hdr ? { colorGamut: 'rec2020', transferFunction: 'hlg' } : {}) },
            });
            return result.supported === true && (result.smooth === true || result.powerEfficient === true);
        } catch (_err) {
            // canPlayType を補助判定に使う
        }
    }

    const video = document.createElement('video');
    return video.canPlayType(`${contentType}; codecs="${codec}"`) !== '';
};

const getNetwork = (): ClientCapabilities['network'] => {
    const connection = (navigator as Navigator & { connection?: { effectiveType?: string; type?: string; saveData?: boolean } }).connection;
    if (connection?.type === 'cellular') return 'cellular';
    if (connection?.saveData === true || connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g') return 'slow';
    if (connection?.effectiveType === '4g') return 'fast';
    return 'unknown';
};

const detect = async (): Promise<ClientCapabilities> => {
    const hdr = window.matchMedia('(dynamic-range: high)').matches;
    const hlg = window.matchMedia('(dynamic-range: high)').matches;
    const [hevc, hevcMain10, h264, av1] = await Promise.all([
        canDecode('video/mp4', 'hvc1.1.6.L93.B0'),
        canDecode('video/mp4', 'hvc1.2.4.L153.B0', true),
        canDecode('video/mp4', 'avc1.640028'),
        canDecode('video/mp4', 'av01.0.08M.08'),
    ]);
    const screen = typeof window.screen === 'undefined' ? undefined : window.screen;

    return { hevc, hevcMain10, h264, av1, hdr, hlg, screenWidth: screen?.width, screenHeight: screen?.height, network: getNetwork() };
};

/** 端末の再生能力を TTL 付きで取得する。 */
export const getClientCapabilities = async (): Promise<ClientCapabilities> => {
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached !== null) {
            const value = JSON.parse(cached) as { expiresAt: number; capabilities: ClientCapabilities };
            if (value.expiresAt > Date.now()) return value.capabilities;
        }
    } catch (_err) {
        // localStorage が使えない環境では都度判定
    }
    const capabilities = await detect();
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ expiresAt: Date.now() + CACHE_TTL_MS, capabilities }));
    } catch (_err) {
        // private browsing などではキャッシュ不要
    }
    return capabilities;
};

export default { getClientCapabilities };
