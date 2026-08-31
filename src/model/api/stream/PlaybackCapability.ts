import { ClientCapabilities } from '../../stream/capability/IClientCapabilities';

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
    network: query.network === 'fast' || query.network === 'slow' || query.network === 'cellular' ? query.network : 'unknown',
});
