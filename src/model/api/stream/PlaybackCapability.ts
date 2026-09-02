import { ClientCapabilities } from '../../stream/capability/IClientCapabilities';
import { PlaybackPreference } from '../../stream/resolver/IPlaybackPolicyResolver';

const bool = (value: unknown): boolean => value === true || value === 'true' || value === '1';
const number = (value: unknown): number | undefined => {
    const result = Number(value);
    return Number.isFinite(result) ? result : undefined;
};

export const parseClientCapabilities = (query: Record<string, unknown>): ClientCapabilities => ({
    hevc: bool(query.hevc),
    hevcMain10: bool(query.hevcMain10),
    h264: bool(query.h264),
    av1: bool(query.av1),
    hdr: bool(query.hdr),
    hlg: bool(query.hlg),
    screenWidth: number(query.screenWidth),
    screenHeight: number(query.screenHeight),
    hardwareDecode: bool(query.hardwareDecode),
    network:
        query.network === 'fast' || query.network === 'slow' || query.network === 'cellular'
            ? query.network
            : 'unknown',
});

/**
 * 端末の設定画面が保持している再生の既定値をクエリから取り出す。
 * 未指定・不正値は「指定なし」として扱い、従来どおりの自動選択に戻す
 * @param query: Record<string, unknown> リクエストクエリ
 * @return PlaybackPreference
 */
export const parsePlaybackPreference = (query: Record<string, unknown>): PlaybackPreference => ({
    hdrMode: query.preferHdr === 'preserve' || query.preferHdr === 'sdr' ? query.preferHdr : 'auto',
    correction:
        query.preferCorrection === 'off' || query.preferCorrection === 'bright' ? query.preferCorrection : 'auto',
    saveData: bool(query.saveData),
});
