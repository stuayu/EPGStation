import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../FeatureFlags';
import IConfiguration from '../IConfiguration';
import IMetadataProviderCacheDB from '../db/IMetadataProviderCacheDB';
import IMetadataProviderRegistry from './IMetadataProviderRegistry';
import IMetadataService from './IMetadataService';
import { MetadataSearchContext, MetadataSearchResult, MetadataWork } from './IMetadataProvider';
import ISyobocalProvider from './syobocal/ISyobocalProvider';
@injectable()
export default class MetadataService implements IMetadataService {
    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('IMetadataProviderRegistry') private registry: IMetadataProviderRegistry,
        @inject('IMetadataProviderCacheDB') private cache: IMetadataProviderCacheDB,
        @inject('ISyobocalProvider') syobocal: ISyobocalProvider,
    ) {
        if (!this.registry.get(syobocal.name)) this.registry.register(syobocal);
    }
    providers() {
        this.enabled();
        return this.registry.list().map(x => ({ name: x.name }));
    }
    async search(query: string, context?: MetadataSearchContext, names?: string[]): Promise<MetadataSearchResult[]> {
        this.enabled();
        const value = query.trim();
        if (!value) throw new Error('MetadataQueryIsEmpty');
        const providers = this.registry.list().filter(x => !names || names.includes(x.name));
        const settled = await Promise.allSettled(providers.map(x => x.search(value, context)));
        return settled.flatMap(x => (x.status === 'fulfilled' ? x.value : [])).sort((a, b) => b.score - a.score);
    }
    async get(providerName: string, externalId: string, force = false): Promise<MetadataWork | null> {
        this.enabled();
        const provider = this.registry.get(providerName);
        if (!provider) throw new Error('MetadataProviderIsNotFound');
        if (!force) {
            const cached = await this.cache.get(providerName, externalId);
            if (cached && Number(cached.expiresAt) > Date.now()) return JSON.parse(cached.payload) as MetadataWork;
        }
        const value = await provider.get(externalId);
        if (value) await this.cache.put(providerName, externalId, value, null, Date.now() + 86400000);
        return value;
    }
    private enabled() {
        if (!isFeatureEnabled(this.config.getConfig(), 'metadataProviders'))
            throw new Error('MetadataProvidersFeatureIsDisabled');
    }
}
