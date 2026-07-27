export interface MetadataSearchContext {
    channelId?: number;
    startAt?: number;
    // プロバイダーチェーン (syobocal → annict → ...) で前段プロバイダーが
    // 確定させたしょぼいカレンダー TID を後段プロバイダーへ引き継ぐために使う
    syobocalTid?: number;
}
export interface MetadataSearchResult {
    provider: string;
    externalId: string;
    title: string;
    originalTitle?: string;
    year?: number;
    score: number;
    imageUrl?: string;
    syobocalTid?: number;
}
export interface MetadataWork extends MetadataSearchResult {
    description?: string;
    episodes?: Array<{ number: number | null; title?: string; airedAt?: number }>;
    raw?: unknown;
    // 差分取得 (ETag / Last-Modified) 用。プロバイダーが対応していれば設定する
    etag?: string | null;
}
export interface MetadataGetOption {
    // 前回取得時の ETag。プロバイダーが対応していれば If-None-Match 等で使う
    etag?: string | null;
}
// 304 (未変更) を示す番兵値。get() がこれを返した場合、呼び出し側はキャッシュ済みの
// MetadataWork をそのまま使い続けてよい (有効期限のみ延長する)
export const METADATA_NOT_MODIFIED = Symbol('MetadataNotModified');
export type WatchStatusForSync = 'watching' | 'watched';
export interface PushWatchRecordResult {
    // 作成された視聴記録の外部 ID (プロバイダー依存の文字列)
    recordId: string;
}
export interface MetadataConnectionTestResult {
    ok: boolean;
    // 疎通できた場合の識別情報 (プロバイダー依存。Annict ならユーザー名)
    username?: string;
    message?: string;
}
export default interface IMetadataProvider {
    readonly name: string;
    search(query: string, context?: MetadataSearchContext): Promise<MetadataSearchResult[]>;
    get(externalId: string, option?: MetadataGetOption): Promise<MetadataWork | null | typeof METADATA_NOT_MODIFIED>;
    /**
     * 視聴記録の書き込みに対応するプロバイダーのみが実装するオプショナルメソッド (§5.5)。
     * workExternalId (作品) の episodeNumber 話目の視聴記録を作成し、作品の視聴ステータスも同期する。
     * 未設定 (トークン未設定など) の場合は null を返す。エピソードが見つからない等は例外を投げる (呼び出し側でリトライする)
     */
    pushWatchRecord?(
        workExternalId: string,
        episodeNumber: number,
        watchStatus: WatchStatusForSync,
    ): Promise<PushWatchRecordResult | null>;
    /**
     * 接続テストに対応するプロバイダーのみが実装するオプショナルメソッド (§6.2)。
     * 保存済みのトークン等を使って実際に疎通し、有効性を確認する
     */
    testConnection?(): Promise<MetadataConnectionTestResult>;
}
