import { inject, injectable } from 'inversify';
import { resolveNumber } from '../AppSettingResolver';
import { isFeatureEnabled } from '../FeatureFlags';
import IConfiguration from '../IConfiguration';
import IAppSettingDB from '../db/IAppSettingDB';
import IMetadataProviderCacheDB from '../db/IMetadataProviderCacheDB';
import IAnnictProvider from './annict/IAnnictProvider';
import {
    METADATA_NOT_MODIFIED,
    MetadataSearchContext,
    MetadataSearchResult,
    MetadataWork,
    PushWatchRecordResult,
    WatchStatusForSync,
} from './IMetadataProvider';
import IMetadataProviderRegistry from './IMetadataProviderRegistry';
import IMetadataService from './IMetadataService';
import ISyobocalProvider from './syobocal/ISyobocalProvider';

/**
 * 外部メタデータプロバイダー (しょぼいカレンダー・Annict 等) を横断的に扱うサービス。
 * - プロバイダーチェーン: syobocal → annict の順で直列実行し、前段の結果 (syobocalTid) を
 *   後段の検索コンテキストへ引き継ぐ
 * - すべての外部照会 (search / get) はキャッシュ (MetadataProviderCacheDB) を経由する
 * - TTL は AppSetting (`metadata.cacheTtlMs`) から取得可能。期限切れキャッシュは定期削除する
 */
@injectable()
export default class MetadataService implements IMetadataService {
    // プロバイダーチェーンの実行順序。前段の結果 (syobocalTid 等) を後段の
    // context へ引き継ぐことで Annict 側の作品確定精度を上げる (§5.2)
    private static readonly CHAIN_ORDER: readonly string[] = ['syobocal', 'annict'];
    private static readonly DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
    private static readonly DELETE_EXPIRED_INTERVAL_MS = 60 * 60 * 1000;
    private static readonly SEARCH_CACHE_PROVIDER_PREFIX = 'search:';

    private deleteExpiredTimer: NodeJS.Timeout | null = null;

    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('IMetadataProviderRegistry') private registry: IMetadataProviderRegistry,
        @inject('IMetadataProviderCacheDB') private cache: IMetadataProviderCacheDB,
        @inject('IAppSettingDB') private settings: IAppSettingDB,
        @inject('ISyobocalProvider') syobocal: ISyobocalProvider,
        @inject('IAnnictProvider') annict: IAnnictProvider,
    ) {
        if (!this.registry.get(syobocal.name)) this.registry.register(syobocal);
        if (!this.registry.get(annict.name)) this.registry.register(annict);
        this.scheduleDeleteExpired();
    }

    /**
     * 登録済みプロバイダー一覧を返す
     */
    public providers() {
        this.enabled();
        return this.registry.list().map(x => ({ name: x.name }));
    }

    /**
     * すべての登録プロバイダー (または names で絞ったプロバイダー) を検索する。
     * syobocal → annict の順にチェーン実行し、前段の syobocalTid を後段の context に引き継ぐ。
     * チェーン対象外のプロバイダーは従来通り並列実行する。結果はプロバイダー単位でキャッシュされる
     * @param query string
     * @param context MetadataSearchContext
     * @param names string[]
     * @return Promise<MetadataSearchResult[]>
     */
    public async search(
        query: string,
        context?: MetadataSearchContext,
        names?: string[],
    ): Promise<MetadataSearchResult[]> {
        this.enabled();
        const value = query.trim();
        if (!value) throw new Error('MetadataQueryIsEmpty');
        const providers = this.registry.list().filter(x => !names || names.includes(x.name));
        const chained = MetadataService.CHAIN_ORDER.map(name => providers.find(x => x.name === name)).filter(
            (x): x is NonNullable<typeof x> => typeof x !== 'undefined',
        );
        const others = providers.filter(x => !chained.includes(x));

        const results: MetadataSearchResult[] = [];
        let chainContext: MetadataSearchContext = { ...context };
        for (const provider of chained) {
            try {
                const found = await this.cachedSearch(provider.name, value, chainContext);
                results.push(...found);
                const best = [...found].sort((a, b) => b.score - a.score)[0];
                if (best?.syobocalTid && !chainContext.syobocalTid) {
                    chainContext = { ...chainContext, syobocalTid: best.syobocalTid };
                }
            } catch {
                // チェーン内の 1 プロバイダーの失敗で他プロバイダーの検索を止めない
            }
        }
        const settled = await Promise.allSettled(others.map(x => this.cachedSearch(x.name, value, context)));
        for (const s of settled) if (s.status === 'fulfilled') results.push(...s.value);
        return results.sort((a, b) => b.score - a.score);
    }

    /**
     * 単一プロバイダーの詳細情報を取得する。キャッシュが有効期限内ならキャッシュを返し、
     * 期限切れの場合は ETag があれば差分取得 (304 なら期限だけ延長) を試みる
     * @param providerName string
     * @param externalId string
     * @param force boolean 強制的にキャッシュを無視して再取得する
     * @return Promise<MetadataWork | null>
     */
    public async get(providerName: string, externalId: string, force = false): Promise<MetadataWork | null> {
        this.enabled();
        const provider = this.registry.get(providerName);
        if (!provider) throw new Error('MetadataProviderIsNotFound');
        const cached = await this.cache.get(providerName, externalId);
        const cachedWork = cached ? (JSON.parse(cached.payload) as MetadataWork) : null;
        if (!force && cached && Number(cached.expiresAt) > Date.now()) return cachedWork;

        const ttl = await this.cacheTtlMs();
        const value = await provider.get(externalId, { etag: cached?.etag ?? null });
        if (value === METADATA_NOT_MODIFIED) {
            // 304: 内容は変わっていないのでキャッシュの有効期限だけ延長する
            if (cachedWork)
                await this.cache.put(providerName, externalId, cachedWork, cached?.etag ?? null, Date.now() + ttl);
            return cachedWork;
        }
        if (value) await this.cache.put(providerName, externalId, value, value.etag ?? null, Date.now() + ttl);
        return value;
    }

    /**
     * 書き込み対応プロバイダーへ視聴記録を送信する (§5.5)。キャッシュは経由しない (書き込み系のため)
     * @param providerName string
     * @param workExternalId string
     * @param episodeNumber number
     * @param watchStatus WatchStatusForSync
     * @return Promise<PushWatchRecordResult | null>
     */
    public async pushWatchRecord(
        providerName: string,
        workExternalId: string,
        episodeNumber: number,
        watchStatus: WatchStatusForSync,
    ): Promise<PushWatchRecordResult | null> {
        this.enabled();
        const provider = this.registry.get(providerName);
        if (!provider || typeof provider.pushWatchRecord !== 'function') {
            throw new Error('MetadataProviderDoesNotSupportPushWatchRecord');
        }
        return await provider.pushWatchRecord(workExternalId, episodeNumber, watchStatus);
    }

    /**
     * search() をキャッシュ経由で実行する (§5.3 アクセスマナー厳守)
     */
    private async cachedSearch(
        providerName: string,
        query: string,
        context?: MetadataSearchContext,
    ): Promise<MetadataSearchResult[]> {
        const provider = this.registry.get(providerName);
        if (!provider) return [];
        const cacheKey = this.searchCacheKey(query, context);
        const cached = await this.cache.get(MetadataService.SEARCH_CACHE_PROVIDER_PREFIX + providerName, cacheKey);
        if (cached && Number(cached.expiresAt) > Date.now())
            return JSON.parse(cached.payload) as MetadataSearchResult[];
        const value = await provider.search(query, context);
        const ttl = await this.cacheTtlMs();
        await this.cache.put(
            MetadataService.SEARCH_CACHE_PROVIDER_PREFIX + providerName,
            cacheKey,
            value,
            null,
            Date.now() + ttl,
        );
        return value;
    }

    private searchCacheKey(query: string, context?: MetadataSearchContext): string {
        return `${query}::${context?.channelId ?? ''}::${context?.startAt ?? ''}::${context?.syobocalTid ?? ''}`;
    }

    private async cacheTtlMs(): Promise<number> {
        const all = await this.settings.getAll();
        const value = (all.metadata as any)?.cacheTtlMs;
        // 優先順位: DB (設定画面) > config.yml (metadataDefaults) > ハードコード既定値 (§6.3)
        const resolved = resolveNumber(
            value,
            this.config.getConfig().metadataDefaults?.cacheTtlMs,
            MetadataService.DEFAULT_CACHE_TTL_MS,
        );
        return resolved > 0 ? resolved : MetadataService.DEFAULT_CACHE_TTL_MS;
    }

    /**
     * 期限切れキャッシュを定期削除する (§5.3)。キャッシュ表の無限増加を防ぐ
     */
    private scheduleDeleteExpired(): void {
        if (this.deleteExpiredTimer !== null) return;
        this.deleteExpiredTimer = setInterval(() => {
            this.cache.deleteExpired(Date.now()).catch(() => undefined);
        }, MetadataService.DELETE_EXPIRED_INTERVAL_MS);
        if (typeof this.deleteExpiredTimer.unref === 'function') this.deleteExpiredTimer.unref();
    }

    private enabled() {
        if (!isFeatureEnabled(this.config.getConfig(), 'metadataProviders'))
            throw new Error('MetadataProvidersFeatureIsDisabled');
    }
}
