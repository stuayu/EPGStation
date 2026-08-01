/**
 * 地上デジタル放送の系列 (BIT の系列識別ベース)
 */
export interface BroadcastAffiliationItem {
    id: string; // 系列 id (例: ntv)
    name: string; // 表示名 (例: 日テレ系)
    order: number; // 表示順 (独立系は 90、未分類は 99)
}

/**
 * 系列判定の対象となるチャンネル情報
 */
export interface BroadcastAffiliationTarget {
    networkId: number;
    channelType: string;
}

export default interface IBroadcastAffiliation {
    updateCache(): Promise<void>;
    getAffiliation(target: BroadcastAffiliationTarget): BroadcastAffiliationItem | null;
    getAffiliations(): BroadcastAffiliationItem[];
    isAffiliationChannelType(channelType: string): boolean;
}
