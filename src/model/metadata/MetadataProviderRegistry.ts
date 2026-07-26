import { injectable } from 'inversify';
import IMetadataProvider from './IMetadataProvider';
import IMetadataProviderRegistry from './IMetadataProviderRegistry';
@injectable()
export default class MetadataProviderRegistry implements IMetadataProviderRegistry {
    private providers = new Map<string, IMetadataProvider>();
    register(provider: IMetadataProvider) {
        if (this.providers.has(provider.name)) throw new Error(`MetadataProviderAlreadyRegistered:${provider.name}`);
        this.providers.set(provider.name, provider);
    }
    get(name: string) {
        return this.providers.get(name);
    }
    list() {
        return [...this.providers.values()];
    }
}
