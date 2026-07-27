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
     * URL が未設定の場合は何もしない。取得成功のたびに onUpdate を呼ぶ。
     * 定期実行の都度、設定画面 (DB: metadata.sharedData.autoUpdate、既定 true) を確認し、
     * false の場合はその回の自動更新をスキップする (§5.8・§6.2)
     */
    startAutoUpdate(onUpdate: (payload: SharedMetadataPayload) => void): void;
    /**
     * 「今すぐ同期」用 (§5.7・§6.2)。自動更新の ON/OFF に関わらず即座に取得し、
     * startAutoUpdate() に登録済みの onUpdate があれば呼び出す
     */
    syncNow(): Promise<SharedMetadataPayload | null>;
}
