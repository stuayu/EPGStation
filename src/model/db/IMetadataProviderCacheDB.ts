import MetadataProviderCache from '../../db/entities/MetadataProviderCache';
export default interface IMetadataProviderCacheDB {
    get(provider: string, externalId: string): Promise<MetadataProviderCache | null>;
    put(provider: string, externalId: string, payload: unknown, etag: string | null, expiresAt: number): Promise<void>;
    deleteExpired(now: number): Promise<void>;
}
