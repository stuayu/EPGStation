import { MetadataSearchContext, MetadataSearchResult, MetadataWork } from './IMetadataProvider';
export interface ProviderInfo {
    name: string;
}
export default interface IMetadataService {
    providers(): ProviderInfo[];
    search(query: string, context?: MetadataSearchContext, providerNames?: string[]): Promise<MetadataSearchResult[]>;
    get(provider: string, externalId: string, force?: boolean): Promise<MetadataWork | null>;
}
