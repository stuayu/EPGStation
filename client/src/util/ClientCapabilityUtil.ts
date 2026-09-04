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

type NetworkInformationSnapshot = {
    effectiveType?: string;
    type?: string;
    saveData?: boolean;
    downlink?: number;
    rtt?: number;
};

/** Network Information API の推定値を再生品質向けに分類する。 */
export const classifyNetwork = (connection?: NetworkInformationSnapshot): ClientCapabilities['network'] => {
    if (connection?.saveData === true) return 'slow';
    if (connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g' || connection?.effectiveType === '3g') return 'slow';

    if (connection?.type === 'cellular') {
        // effectiveType は通信規格ではなく実効品質。十分な帯域と低い RTT が観測できる
        // 高品質セルラーは Wi-Fi と同様に扱い、回線種別だけで最低画質へ固定しない。
        if (connection.effectiveType === '4g' && (connection.downlink ?? 0) >= 10 && (connection.rtt ?? Number.POSITIVE_INFINITY) <= 200) {
            return 'fast';
        }
        return 'cellular';
    }
    if (connection?.effectiveType === '4g') return 'fast';
    return 'unknown';
};

const getNetwork = (): ClientCapabilities['network'] =>
    classifyNetwork((navigator as Navigator & { connection?: NetworkInformationSnapshot }).connection);

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
            // Codec/HDR 能力だけをキャッシュする。回線状態は移動やテザリングで変わるため毎回取得する。
            if (value.expiresAt > Date.now()) return { ...value.capabilities, network: getNetwork() };
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
