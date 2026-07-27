import { inject, injectable } from 'inversify';
import { resolveBoolean, resolveNumber } from '../../AppSettingResolver';
import { isFeatureEnabled } from '../../FeatureFlags';
import IAppSettingDB from '../../db/IAppSettingDB';
import IWikidataProgramDB, { WikidataProgramUpsert } from '../../db/IWikidataProgramDB';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import { strictProgramKey } from '../../series/SeriesNormalizer';
import IMetadataEndpointResolver from '../IMetadataEndpointResolver';
import IProviderHttpClient from '../IProviderHttpClient';
import IWikidataProgramDictionary, {
    WikidataProgramDictionaryStatus,
    WikidataProgramSyncResult,
} from './IWikidataProgramDictionary';

interface SparqlBinding {
    [key: string]: { value: string } | undefined;
}

/**
 * Wikidata の SPARQL エンドポイントから日本語ラベルを持つテレビ番組を一括取得し、
 * ローカル DB へ辞書として保持する。
 *
 * しょぼいカレンダー / Annict がアニメ専門なのに対し、こちらは**全ジャンル**を収録する。
 * ドラマ・バラエティ・情報番組・ニュース、さらにローカル局の番組 (「じゃじゃじゃTV」「ふくしまSHOW」等)
 * まで載っているため、アニメ辞書では拾えなかったシリーズを確定できる。
 *
 * 設計上の注意:
 * - **照合は strictKey の完全一致のみ**。一般番組は「パラダイス」「わっち!!」のような短く
 *   一般的なタイトルが多く、アニメ辞書と同じ含有一致を許すと誤爆する
 *   (実データで「ゲームパラダイス」→「パラダイス」の誤りが出た)。装飾を取り除くのは
 *   SeriesNormalizer / LLM 抽出の役目とし、この辞書は「正解の集合」に徹する
 * - `P11648` (しょぼいカレンダーのシリーズ ID) を取り込み、既存のアニメ辞書と厳密に結合する。
 *   同じ作品が 2 つのエントリに割れないようにするための唯一の確実なキー
 * - `P31/P279*` によるサブクラス再帰は公開エンドポイントでタイムアウトする (実測で 504) ため、
 *   主要クラスを直接指定してページングする
 */
@injectable()
export default class WikidataProgramDictionary implements IWikidataProgramDictionary {
    // 取得対象クラス: テレビ番組 / テレビシリーズ / テレビ映画 / テレビスペシャル。
    // テレビシリーズのエピソード (Q21191270) は 1 話単位なので辞書には入れない
    private static readonly CLASSES = ['wd:Q15416', 'wd:Q5398426', 'wd:Q506240', 'wd:Q1261214'];
    // 1 ページあたりの取得件数 (実測で 5000 件 / 約 2.4 秒)
    private static readonly PAGE_SIZE = 5000;
    // 暴走時の保険
    private static readonly MAX_PAGES = 40;
    private static readonly REQUEST_INTERVAL_MS = 1000;
    private static readonly FETCH_TIMEOUT_MS = 180 * 1000;
    private static readonly DEFAULT_SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
    // 起動直後は EPG 更新などと重なるため少し遅らせてから初回同期する
    private static readonly INITIAL_SYNC_DELAY_MS = 8 * 60 * 1000;
    // Wikidata は User-Agent の明示を求めている
    private static readonly USER_AGENT = 'EPGStation/2 (series matching dictionary)';

    private log: ILogger;
    private running: boolean = false;
    private autoSyncTimer: NodeJS.Timeout | null = null;
    private lastSyncedAt: number | null = null;
    private lastError: string | null = null;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IProviderHttpClient') private http: IProviderHttpClient,
        @inject('IWikidataProgramDB') private db: IWikidataProgramDB,
        @inject('IAppSettingDB') private settings: IAppSettingDB,
        @inject('IConfiguration') private config: IConfiguration,
        @inject('IMetadataEndpointResolver') private endpoints: IMetadataEndpointResolver,
    ) {
        this.log = logger.getLogger();
    }

    public async sync(): Promise<WikidataProgramSyncResult> {
        if (this.running === true) return { ...(await this.getStatus()), imported: 0 };
        this.running = true;
        this.lastError = null;
        let imported = 0;
        try {
            // 外部 ID (件数が少ないので一括取得) を先に引き、ラベル取り込み時に併記する
            const externalIds = await this.fetchExternalIds();
            const aliasesByQid = await this.fetchAliases();

            for (const klass of WikidataProgramDictionary.CLASSES) {
                for (let page = 0; page < WikidataProgramDictionary.MAX_PAGES; page++) {
                    const rows = await this.fetchLabels(klass, page * WikidataProgramDictionary.PAGE_SIZE);
                    const values = rows
                        .map(row => this.toUpsert(row, externalIds, aliasesByQid))
                        .filter((x): x is WikidataProgramUpsert => x !== null);
                    await this.db.bulkUpsert(values);
                    imported += values.length;
                    if (rows.length < WikidataProgramDictionary.PAGE_SIZE) break;
                    await this.sleep(WikidataProgramDictionary.REQUEST_INTERVAL_MS);
                }
            }
            this.lastSyncedAt = Date.now();
            this.log.system.info(`wikidata program dictionary: synced ${imported} programs`);
        } catch (err) {
            this.lastError = err instanceof Error ? err.message : String(err);
            this.log.system.error('wikidata program dictionary: sync failed');
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

        const initial = setTimeout(run, WikidataProgramDictionary.INITIAL_SYNC_DELAY_MS);
        if (typeof initial.unref === 'function') initial.unref();

        this.autoSyncTimer = setInterval(() => {
            void (async () => {
                if ((await this.syncIntervalMs()) <= 0) return;
                run();
            })();
        }, WikidataProgramDictionary.DEFAULT_SYNC_INTERVAL_MS);
        if (typeof this.autoSyncTimer.unref === 'function') this.autoSyncTimer.unref();
    }

    public async getStatus(): Promise<WikidataProgramDictionaryStatus> {
        return {
            programCount: await this.db.count(),
            linkedToSyobocalCount: await this.db.countLinkedToSyobocal(),
            lastSyncedAt: this.lastSyncedAt,
            running: this.running,
            error: this.lastError,
        };
    }

    /**
     * 日本語ラベルを 1 ページ分取得する
     */
    private async fetchLabels(klass: string, offset: number): Promise<SparqlBinding[]> {
        return await this.query(
            `SELECT ?i ?l WHERE { ?i wdt:P31 ${klass} ; rdfs:label ?l . FILTER(LANG(?l)="ja") }` +
                ` ORDER BY ?i LIMIT ${WikidataProgramDictionary.PAGE_SIZE} OFFSET ${offset}`,
        );
    }

    /**
     * 日本語の別名 (skos:altLabel) を qid ごとにまとめて取得する
     */
    private async fetchAliases(): Promise<Map<string, string[]>> {
        const result = new Map<string, string[]>();
        for (const klass of WikidataProgramDictionary.CLASSES) {
            for (let page = 0; page < WikidataProgramDictionary.MAX_PAGES; page++) {
                const rows = await this.query(
                    `SELECT ?i ?a WHERE { ?i wdt:P31 ${klass} ; skos:altLabel ?a . FILTER(LANG(?a)="ja") }` +
                        ` ORDER BY ?i LIMIT ${WikidataProgramDictionary.PAGE_SIZE} OFFSET ${page * WikidataProgramDictionary.PAGE_SIZE}`,
                );
                for (const row of rows) {
                    const qid = WikidataProgramDictionary.qidOf(row.i?.value);
                    const alias = row.a?.value;
                    if (qid === null || typeof alias !== 'string') continue;
                    const list = result.get(qid);
                    if (typeof list === 'undefined') result.set(qid, [alias]);
                    else list.push(alias);
                }
                if (rows.length < WikidataProgramDictionary.PAGE_SIZE) break;
                await this.sleep(WikidataProgramDictionary.REQUEST_INTERVAL_MS);
            }
        }

        return result;
    }

    /**
     * しょぼいカレンダー ID (P11648) と TMDb テレビシリーズ ID (P4983) を取得する。
     * テレビ番組以外の項目も含まれるが、ラベル取り込み時に qid で突き合わせるので害はない
     */
    private async fetchExternalIds(): Promise<Map<string, { syobocalTid: number | null; tmdbId: number | null }>> {
        const result = new Map<string, { syobocalTid: number | null; tmdbId: number | null }>();
        for (const [property, key] of [
            ['P11648', 'syobocalTid'],
            ['P4983', 'tmdbId'],
        ] as const) {
            const rows = await this.query(`SELECT ?i ?v WHERE { ?i wdt:${property} ?v }`);
            for (const row of rows) {
                const qid = WikidataProgramDictionary.qidOf(row.i?.value);
                const value = Number(row.v?.value);
                if (qid === null || Number.isFinite(value) === false || value <= 0) continue;
                const current = result.get(qid) ?? { syobocalTid: null, tmdbId: null };
                current[key] = value;
                result.set(qid, current);
            }
            await this.sleep(WikidataProgramDictionary.REQUEST_INTERVAL_MS);
        }

        return result;
    }

    /**
     * SPARQL を実行して結果の binding 配列を返す
     */
    private async query(sparql: string): Promise<SparqlBinding[]> {
        const url = `${await this.endpoints.resolve('wikidata')}?format=json&query=${encodeURIComponent(sparql)}`;
        const response = await this.http.get(url, {
            headers: { accept: 'application/sparql-results+json', 'user-agent': WikidataProgramDictionary.USER_AGENT },
            timeoutMs: WikidataProgramDictionary.FETCH_TIMEOUT_MS,
        });
        if (response.status >= 400) throw new Error(`WikidataHttpStatus:${response.status}`);

        return response.json<{ results?: { bindings?: SparqlBinding[] } }>().results?.bindings ?? [];
    }

    /**
     * SPARQL の 1 行を DB 登録用の形へ変換する。qid・ラベルが無いものは除外する
     */
    private toUpsert(
        row: SparqlBinding,
        externalIds: Map<string, { syobocalTid: number | null; tmdbId: number | null }>,
        aliasesByQid: Map<string, string[]>,
    ): WikidataProgramUpsert | null {
        const qid = WikidataProgramDictionary.qidOf(row.i?.value);
        const title = (row.l?.value ?? '').trim();
        if (qid === null || title === '') return null;
        const strictKey = strictProgramKey(title);
        if (strictKey.length < 2) return null;

        // 正式ラベルと同じキーになる別名は登録しない
        const aliasKeys = new Map<string, number>();
        for (const alias of aliasesByQid.get(qid) ?? []) {
            const key = strictProgramKey(alias.trim());
            if (key.length < 2 || key === strictKey) continue;
            if (aliasKeys.has(key) === false) aliasKeys.set(key, 2);
        }
        const ids = externalIds.get(qid);

        return {
            program: {
                qid,
                title,
                strictKey,
                syobocalTid: ids?.syobocalTid ?? null,
                tmdbId: ids?.tmdbId ?? null,
                updatedAt: Date.now(),
            },
            aliases: [...aliasKeys.entries()].map(([key, rank]) => ({ strictKey: key, qid, rank })),
        };
    }

    /**
     * SPARQL が返す項目 URI (http://www.wikidata.org/entity/Q123) から QID を取り出す
     */
    private static qidOf(uri: string | undefined): string | null {
        if (typeof uri !== 'string') return null;
        const qid = uri.split('/').pop() ?? '';

        return /^Q\d+$/u.test(qid) ? qid : null;
    }

    /**
     * Wikidata 連携が有効か (機能フラグ + 設定画面 / config.yml の有効化)
     */
    private async enabled(): Promise<boolean> {
        const config = this.config.getConfig();
        if (isFeatureEnabled(config, 'metadataProviders') === false) return false;
        const all = await this.settings.getAll();

        // 既定で有効。API キー不要・無料で、アニメ以外のジャンルを照合できる唯一の辞書のため
        return resolveBoolean(
            (all.metadata as any)?.wikidata?.enabled,
            config.metadataDefaults?.wikidata?.enabled,
            true,
        );
    }

    private async syncIntervalMs(): Promise<number> {
        const all = await this.settings.getAll();

        return resolveNumber(
            (all.metadata as any)?.wikidata?.syncIntervalMs,
            this.config.getConfig().metadataDefaults?.wikidata?.syncIntervalMs,
            WikidataProgramDictionary.DEFAULT_SYNC_INTERVAL_MS,
        );
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
