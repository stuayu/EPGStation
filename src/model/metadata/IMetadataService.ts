import {
    MetadataSearchContext,
    MetadataSearchResult,
    MetadataWork,
    PushWatchRecordResult,
    WatchStatusForSync,
} from './IMetadataProvider';
export interface ProviderInfo {
    name: string;
}
export default interface IMetadataService {
    providers(): ProviderInfo[];
    search(query: string, context?: MetadataSearchContext, providerNames?: string[]): Promise<MetadataSearchResult[]>;
    get(provider: string, externalId: string, force?: boolean): Promise<MetadataWork | null>;
    /**
     * 書き込み対応プロバイダーへ視聴記録を送信する (§5.5)。プロバイダーが pushWatchRecord に
     * 対応していない場合は例外を投げる
     */
    pushWatchRecord(
        provider: string,
        workExternalId: string,
        episodeNumber: number,
        watchStatus: WatchStatusForSync,
    ): Promise<PushWatchRecordResult | null>;
}
