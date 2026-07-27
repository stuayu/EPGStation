import { inject, injectable } from 'inversify';
import { resolveBoolean, resolveNumber } from '../../AppSettingResolver';
import { isFeatureEnabled } from '../../FeatureFlags';
import IAnnictWorkDB, { AnnictWorkUpsert } from '../../db/IAnnictWorkDB';
import IAppSettingDB from '../../db/IAppSettingDB';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import ISecretCrypto from '../../security/ISecretCrypto';
import { syobocalLookupKey } from '../../series/SeriesNormalizer';
import IMetadataEndpointResolver from '../IMetadataEndpointResolver';
import IProviderHttpClient from '../IProviderHttpClient';
import IAnnictWorkDictionary, { AnnictWorkDictionaryStatus, AnnictWorkSyncResult } from './IAnnictWorkDictionary';

interface AnnictWorkNode {
    annictId?: number;
    title?: string;
    titleEn?: string;
    titleKana?: string;
    titleRo?: string;
    syobocalTid?: number;
    seasonYear?: number;
    seasonName?: string;
    episodesCount?: number;
    media?: string;
    image?: {
        recommendedImageUrl?: string;
        facebookOgImageUrl?: string;
        twitterBiggerAvatarUrl?: string;
        copyright?: string;
    };
}

/**
 * Annict の全作品を searchWorks のページングで一括取得し、ローカル DB へ辞書として保持する。
 *
 * しょぼいカレンダー辞書 (SyobocalTitleDictionary) と役割は同じだが、以下の点で補完関係にある:
 * - 収録作品数が多い (約 1.7 万件 vs しょぼいカレンダー約 8 千件)。しょぼいカレンダー未収録の
 *   配信作品・劇場作品を拾える
 * - 英題 (titleEn)・ローマ字 (titleRo)・かな (titleKana) を持つため、英字表記で放送される作品
 *   ("Ubel Blatt" "Die Neue These" 等) の照合キーを増やせる
 * - syobocalTid を保持しているため、しょぼいカレンダー作品との厳密な 1:1 結合ができる
 *   (タイトル類似度による曖昧な突き合わせが不要になり、Series.annictId を確実に決められる)
 *
 * Annict は差分取得の手段を提供していないため、同期は常に全件取得となる (1 ページ 500 件 × 約 35 ページ)。
 */
@injectable()
export default class AnnictWorkDictionary implements IAnnictWorkDictionary {
    // 1 ページあたりの取得件数 (500 まで受け付けることを実 API で確認済み)
    private static readonly PAGE_SIZE = 500;
    // 暴走時の保険。1 ページ 500 件なので 2 万件を大きく超えたら打ち切る
    private static readonly MAX_PAGES = 200;
    private static readonly REQUEST_INTERVAL_MS = 300;
    private static readonly FETCH_TIMEOUT_MS = 60 * 1000;
    private static readonly DEFAULT_SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
    // 起動直後は EPG 更新などと重なるため少し遅らせてから初回同期する
    private static readonly INITIAL_SYNC_DELAY_MS = 5 * 60 * 1000;
    private static readonly QUERY = `query BulkWorks($first: Int!, $after: String) {
  searchWorks(first: $first, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {
    pageInfo { hasNextPage endCursor }
    nodes {
      annictId title titleEn titleKana titleRo syobocalTid seasonYear seasonName episodesCount media
      image { recommendedImageUrl facebookOgImageUrl twitterBiggerAvatarUrl copyright }
    }
  }
}`;

    private log: ILogger;
    private running: boolean = false;
    private autoSyncTimer: NodeJS.Timeout | null = null;
    private lastSyncedAt: number | null = null;
    private lastError: string | null = null;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IProviderHttpClient') private http: IProviderHttpClient,
        @inject('IAnnictWorkDB') private db: IAnnictWorkDB,
        @inject('IAppSettingDB') private settings: IAppSettingDB,
        @inject('ISecretCrypto') private crypto: ISecretCrypto,
        @inject('IConfiguration') private config: IConfiguration,
        @inject('IMetadataEndpointResolver') private endpoints: IMetadataEndpointResolver,
    ) {
        this.log = logger.getLogger();
    }

    public async sync(): Promise<AnnictWorkSyncResult> {
        if (this.running === true) return { ...(await this.getStatus()), imported: 0 };
        this.running = true;
        this.lastError = null;
        let imported = 0;
        try {
            const token = await this.token();
            if (token === null) throw new Error('AnnictTokenIsNotConfigured');

            let after: string | null = null;
            for (let page = 0; page < AnnictWorkDictionary.MAX_PAGES; page++) {
                const connection = await this.fetchPage(token, after);
                const values = (connection.nodes ?? [])
                    .map(node => this.toUpsert(node))
                    .filter((x): x is AnnictWorkUpsert => x !== null);
                await this.db.bulkUpsert(values);
                imported += values.length;
                if (connection.pageInfo?.hasNextPage !== true) break;
                after = connection.pageInfo.endCursor ?? null;
                if (after === null) break;
                await this.sleep(AnnictWorkDictionary.REQUEST_INTERVAL_MS);
            }
            this.lastSyncedAt = Date.now();
            this.log.system.info(`annict work dictionary: synced ${imported} works`);
        } catch (err) {
            this.lastError = err instanceof Error ? err.message : String(err);
            this.log.system.error('annict work dictionary: sync failed');
            this.log.system.error(err);
        } finally {
            this.running = false;
        }
        return { ...(await this.getStatus()), imported };
    }

    public startAutoSync(): void {
        if (this.autoSyncTimer !== null) return;

        const run = (): void => {
            void (async () => {
                if ((await this.enabled()) === false) return;
                await this.sync();
            })();
        };

        const initial = setTimeout(run, AnnictWorkDictionary.INITIAL_SYNC_DELAY_MS);
        if (typeof initial.unref === 'function') initial.unref();

        this.autoSyncTimer = setInterval(() => {
            void (async () => {
                if ((await this.syncIntervalMs()) <= 0) return;
                run();
            })();
        }, AnnictWorkDictionary.DEFAULT_SYNC_INTERVAL_MS);
        if (typeof this.autoSyncTimer.unref === 'function') this.autoSyncTimer.unref();
    }

    public async getStatus(): Promise<AnnictWorkDictionaryStatus> {
        return {
            workCount: await this.db.count(),
            linkedToSyobocalCount: await this.db.countLinkedToSyobocal(),
            lastSyncedAt: this.lastSyncedAt,
            running: this.running,
            error: this.lastError,
        };
    }

    /**
     * searchWorks を 1 ページ分取得する
     */
    private async fetchPage(
        token: string,
        after: string | null,
    ): Promise<{ pageInfo?: { hasNextPage?: boolean; endCursor?: string }; nodes?: AnnictWorkNode[] }> {
        const response = await this.http.post(
            await this.endpoints.resolve('annict'),
            JSON.stringify({
                query: AnnictWorkDictionary.QUERY,
                variables: { first: AnnictWorkDictionary.PAGE_SIZE, after },
            }),
            {
                headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
                timeoutMs: AnnictWorkDictionary.FETCH_TIMEOUT_MS,
            },
        );
        if (response.status === 401 || response.status === 403) throw new Error('AnnictAuthenticationFailed');
        if (response.status >= 400) throw new Error(`AnnictHttpStatus:${response.status}`);
        const result = response.json<{
            data?: {
                searchWorks?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string }; nodes?: AnnictWorkNode[] };
            };
            errors?: Array<{ message: string }>;
        }>();
        if (result.errors?.length) throw new Error(`AnnictGraphQLError:${result.errors.map(x => x.message).join(',')}`);
        return result.data?.searchWorks ?? {};
    }

    /**
     * searchWorks の 1 ノードを DB 登録用の形へ変換する。作品 ID・タイトルが無いものは除外する
     */
    private toUpsert(node: AnnictWorkNode): AnnictWorkUpsert | null {
        const annictId = Number(node.annictId);
        const title = (node.title ?? '').trim();
        if (Number.isFinite(annictId) === false || annictId <= 0 || title === '') return null;
        const lookupKey = syobocalLookupKey(title);
        if (lookupKey.length < 2) return null;

        // 別名候補: 英題・ローマ字・かな。正式タイトルと同じキーになるものは登録しない
        const aliases = new Map<string, number>();
        for (const value of [node.titleEn, node.titleRo, node.titleKana]) {
            const key = syobocalLookupKey((value ?? '').trim());
            if (key.length < 2 || key === lookupKey) continue;
            if (aliases.has(key) === false) aliases.set(key, 2);
        }

        return {
            work: {
                annictId,
                title,
                lookupKey,
                titleEn: AnnictWorkDictionary.textOrNull(node.titleEn),
                titleKana: AnnictWorkDictionary.textOrNull(node.titleKana),
                titleRo: AnnictWorkDictionary.textOrNull(node.titleRo),
                syobocalTid: typeof node.syobocalTid === 'number' && node.syobocalTid > 0 ? node.syobocalTid : null,
                seasonYear: typeof node.seasonYear === 'number' ? node.seasonYear : null,
                seasonName: AnnictWorkDictionary.textOrNull(node.seasonName),
                episodesCount:
                    typeof node.episodesCount === 'number' && node.episodesCount > 0 ? node.episodesCount : null,
                media: AnnictWorkDictionary.textOrNull(node.media),
                imageUrl: AnnictWorkDictionary.pickImageUrl(node),
                imageCopyright: AnnictWorkDictionary.textOrNull(node.image?.copyright),
                updatedAt: Date.now(),
            },
            aliases: [...aliases.entries()].map(([key, rank]) => ({ lookupKey: key, annictId, rank })),
        };
    }

    /**
     * アイキャッチに使う画像 URL を選ぶ。画質の良い順に見て最初に見つかったものを採用する。
     * twitterBiggerAvatarUrl (`twitter.com/{account}/profile_image?size=bigger`) はそのままでは
     * 画像を返さない (認証必須になり text/html が返る) が、SeriesImageModel が取得時に
     * fxtwitter 経由で実際のアバター画像へ解決するため候補に残す
     */
    private static pickImageUrl(node: AnnictWorkNode): string | null {
        for (const value of [
            node.image?.recommendedImageUrl,
            node.image?.facebookOgImageUrl,
            node.image?.twitterBiggerAvatarUrl,
        ]) {
            const url = AnnictWorkDictionary.textOrNull(value);
            // http/https 以外 (data: など想定外のスキーム) は取得対象にしない
            if (url !== null && /^https?:\/\//iu.test(url)) return url;
        }
        return null;
    }

    private static textOrNull(value: string | undefined): string | null {
        const text = (value ?? '').trim();
        return text === '' ? null : text;
    }

    /**
     * Annict 連携が有効か (機能フラグ + 設定画面の有効化 + トークン設定)
     */
    private async enabled(): Promise<boolean> {
        const config = this.config.getConfig();
        if (isFeatureEnabled(config, 'metadataProviders') === false) return false;
        const all = await this.settings.getAll();
        return resolveBoolean((all.metadata as any)?.annict?.enabled, config.metadataDefaults?.annict?.enabled, false);
    }

    private async token(): Promise<string | null> {
        if ((await this.enabled()) === false) return null;
        const all = await this.settings.getAll();
        const value = (all.metadata as any)?.annict?.token;
        if (typeof value !== 'string' || value.length === 0) return null;
        return this.crypto.isEncrypted(value) ? this.crypto.decrypt(value) : value;
    }

    private async syncIntervalMs(): Promise<number> {
        const all = await this.settings.getAll();
        return resolveNumber(
            (all.metadata as any)?.annict?.workSyncIntervalMs,
            this.config.getConfig().metadataDefaults?.annict?.workSyncIntervalMs,
            AnnictWorkDictionary.DEFAULT_SYNC_INTERVAL_MS,
        );
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
