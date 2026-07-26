import IMetadataProvider from './IMetadataProvider';
export default interface IMetadataProviderRegistry {
    register(provider: IMetadataProvider): void;
    get(name: string): IMetadataProvider | undefined;
    list(): IMetadataProvider[];
}
