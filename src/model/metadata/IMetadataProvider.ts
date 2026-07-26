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
export default interface IMetadataProvider {
    readonly name: string;
    search(query: string, context?: MetadataSearchContext): Promise<MetadataSearchResult[]>;
    get(
        externalId: string,
        option?: MetadataGetOption,
    ): Promise<MetadataWork | null | typeof METADATA_NOT_MODIFIED>;
}
