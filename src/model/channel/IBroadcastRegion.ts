/**
 * 地上デジタル放送の地域 (地域符号ベース)
 */
export interface BroadcastRegionItem {
    id: string; // 地域 id (例: kanto)
    name: string; // 表示名 (例: 関東)
    order: number; // 表示順 (都道府県コード。複数県のグループは最小の県コード、判定不能は 99)
}

/**
 * 地域判定の対象となるチャンネル情報
 */
export interface BroadcastRegionTarget {
    networkId: number;
    serviceId: number;
    channelType: string;
}

export default interface IBroadcastRegion {
    getRegion(target: BroadcastRegionTarget): BroadcastRegionItem | null;
    getRegions(): BroadcastRegionItem[];
    isRegionalChannelType(channelType: string): boolean;
}
