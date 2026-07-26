export interface SharedChannelMapEntry {
    chId: number;
    networkId: number;
    serviceId: number;
    syobocal?: boolean;
}
export interface SharedMetadataPayload {
    // しょぼいカレンダー ChID ⇄ networkId/serviceId のマッピング表 (§5.1)
    channelMap?: SharedChannelMapEntry[];
    // 正規化タイトル → 別名表記のエイリアス辞書 (将来拡張用。現状は読み込むのみでシリーズ解決には未接続)
    titleAliases?: Array<{ normalizedTitle: string; aliases: string[] }>;
}
export default interface ISharedDataFetcher {
    /**
     * config.metadataSharedDataUrl から共有静的データを取得する。
     * 成功時はローカルキャッシュへ保存して返す。取得失敗時 (オフライン・URL 未設定・
     * パース失敗等) はローカルキャッシュ (前回取得分) があればそれを返し、無ければ null を返す
     * (呼び出し側は同梱データにフォールバックすること)
     */
    fetch(): Promise<SharedMetadataPayload | null>;
    /**
     * 起動時 + config.metadataSharedDataUpdateIntervalMs 間隔で自動更新する。
     * URL が未設定の場合は何もしない。取得成功のたびに onUpdate を呼ぶ
     */
    startAutoUpdate(onUpdate: (payload: SharedMetadataPayload) => void): void;
}
