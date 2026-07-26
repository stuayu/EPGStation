export interface MetadataSearchContext {
    channelId?: number;
    startAt?: number;
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
}
export default interface IMetadataProvider {
    readonly name: string;
    search(query: string, context?: MetadataSearchContext): Promise<MetadataSearchResult[]>;
    get(externalId: string): Promise<MetadataWork | null>;
}
