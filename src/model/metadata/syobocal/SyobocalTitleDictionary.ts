import { inject, injectable } from 'inversify';
import { resolveBoolean, resolveNumber } from '../../AppSettingResolver';
import { isFeatureEnabled } from '../../FeatureFlags';
import IAppSettingDB from '../../db/IAppSettingDB';
import ISyobocalTitleDB, { SyobocalTitleUpsert } from '../../db/ISyobocalTitleDB';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import { buildSeriesLookupKeys, syobocalLookupKey } from '../../series/SeriesNormalizer';
import IProviderHttpClient from '../IProviderHttpClient';
import ISyobocalTitleDictionary, {
    SyobocalTitleDictionaryStatus,
    SyobocalTitleMatch,
    SyobocalTitleSyncOption,
    SyobocalTitleSyncResult,
} from './ISyobocalTitleDictionary';
import { xmlItems } from './SyobocalXml';

interface AliasIndexEntry {
    tid: number;
    rank: number;
}

/**
 * しょぼいカレンダーの TitleLookup を一括で叩き、アニメ作品タイトルの辞書をローカル DB に構築する。
 *
 * シリーズ自動マッピングは従来「録画タイトル同士の類似度」だけで判定していたため、
 * 放送局ごとの表記ゆれ (「第壱話」「break1」「TVアニメ『X』」「水曜アニメ・」等) で同一作品が
 * 別シリーズに分裂していた。本クラスはしょぼいカレンダー側の正式タイトル・略称・英題・別名 (Keywords) を
 * 「正解辞書」として持ち、録画タイトルをその TID へ寄せることでこの分裂を防ぐ (SeriesResolver から利用)。
 *
 * - 初回 (辞書が空) は全件取得、以降は lastUpdate 以降の差分のみ取得する
 * - 照合キーは記号・空白・長音/ダッシュ/引用符をすべて落とした「骨格」文字列 (syobocalLookupKey)
 * - 完全一致で引けない場合は「辞書キーが録画キーに含まれる最長のもの」を採用する。
 *   短い辞書キーが長い録画タイトルに偶然含まれる誤爆を防ぐため、長さ比が CONTAIN_MIN_RATIO 未満なら不採用とする
 */
@injectable()
export default class SyobocalTitleDictionary implements ISyobocalTitleDictionary {
    private static readonly BASE_URL = 'https://cal.syoboi.jp/db.php';
    // 取得するフィールド。Comment (あらすじ・スタッフ) は巨大で用途が無いため取得しない (全件 24MB → 9.5MB)
    private static readonly FIELDS =
        'TID,Title,ShortTitle,TitleYomi,TitleEN,Keywords,Cat,FirstYear,FirstMonth,SubTitles,LastUpdate';
    // 全件取得は 10MB 近い XML を受けるため長めのタイムアウトを取る
    private static readonly FETCH_TIMEOUT_MS = 180 * 1000;
    private static readonly DEFAULT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
    // 起動直後は EPG 更新などと重なるため少し遅らせてから初回同期する
    private static readonly INITIAL_SYNC_DELAY_MS = 60 * 1000;
    // 含有マッチで採用する最短の辞書キー長 (これ未満は偶然の一致が多すぎる)
    private static readonly CONTAIN_MIN_KEY_LENGTH = 3;
    // 含有マッチで要求する「辞書キー長 / 録画キー長」の下限
    private static readonly CONTAIN_MIN_RATIO = 0.5;
    private static readonly EXACT_CONFIDENCE = 1;
    private static readonly CONTAIN_CONFIDENCE = 0.95;
    // メモリ上の索引を DB と突き合わせ直す間隔 (ms)。
    // 辞書は Operator の自動同期と Service の「今すぐ同期」の両方から更新されうるため、
    // 自プロセスの sync() 以外による更新にもこの間隔で追随する
    private static readonly INDEX_REVALIDATE_MS = 5 * 60 * 1000;

    private log: ILogger;
    private running: boolean = false;
    private autoSyncTimer: NodeJS.Timeout | null = null;
    private lastSyncedAt: number | null = null;
    private lastError: string | null = null;
    // 照合キー → TID の索引 (DB から一度だけ読み込む)。sync() のたびに破棄して作り直す
    private aliasIndex: Map<string, AliasIndexEntry> | null = null;
    // 含有マッチ用に長さ降順で並べた照合キー
    private keysByLength: string[] = [];
    // 索引を構築した時刻と、その時点の DB の内容を表す署名 (件数:最終更新日時)
    private indexBuiltAt: number = 0;
    private indexSignature: string | null = null;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IProviderHttpClient') private http: IProviderHttpClient,
        @inject('ISyobocalTitleDB') private db: ISyobocalTitleDB,
        @inject('IAppSettingDB') private settings: IAppSettingDB,
        @inject('IConfiguration') private config: IConfiguration,
    ) {
        this.log = logger.getLogger();
    }

    public async sync(option: SyobocalTitleSyncOption = {}): Promise<SyobocalTitleSyncResult> {
        if (this.running === true) {
            return { ...(await this.getStatus()), imported: 0, full: false };
        }
        this.running = true;
        this.lastError = null;
        let imported = 0;
        let full = option.full === true;
        try {
            const cursor = full === true ? null : await this.db.getLatestLastUpdate();
            if (cursor === null) full = true;
            if (full === true && option.full === true) await this.db.clear();

            const xml = await this.fetch(cursor);
            const rows = xmlItems(xml, 'TitleItem');
            const values = rows.map(row => this.toUpsert(row)).filter((x): x is SyobocalTitleUpsert => x !== null);
            await this.db.bulkUpsert(values);
            imported = values.length;
            this.lastSyncedAt = Date.now();
            // 辞書が変わったので索引を破棄する (次回 lookup 時に再構築される)
            this.aliasIndex = null;
            this.log.system.info(
                `syobocal title dictionary: synced ${imported} titles (${full === true ? 'full' : 'incremental'})`,
            );
        } catch (err) {
            this.lastError = err instanceof Error ? err.message : String(err);
            this.log.system.error('syobocal title dictionary: sync failed');
            this.log.system.error(err);
        } finally {
            this.running = false;
        }
        return { ...(await this.getStatus()), imported, full };
    }

    public startAutoSync(): void {
        if (this.autoSyncTimer !== null) return;

        const run = (): void => {
            void (async () => {
                if ((await this.enabled()) === false) return;
                await this.sync();
            })();
        };

        const initial = setTimeout(run, SyobocalTitleDictionary.INITIAL_SYNC_DELAY_MS);
        if (typeof initial.unref === 'function') initial.unref();

        this.autoSyncTimer = setInterval(() => {
            void (async () => {
                const interval = await this.syncIntervalMs();
                if (interval <= 0) return;
                run();
            })();
        }, SyobocalTitleDictionary.DEFAULT_SYNC_INTERVAL_MS);
        if (typeof this.autoSyncTimer.unref === 'function') this.autoSyncTimer.unref();
    }

    public async lookup(recordedTitle: string): Promise<SyobocalTitleMatch | null> {
        if ((await this.enabled()) === false) return null;
        const index = await this.ensureIndex();
        if (index.size === 0) return null;

        for (const key of buildSeriesLookupKeys(recordedTitle)) {
            const hit = this.lookupKey(key, index);
            if (hit !== null) {
                const title = await this.db.get(hit.tid);
                if (title === null) continue;
                return {
                    tid: title.tid,
                    title: title.title,
                    totalEpisodes: title.totalEpisodes,
                    matchType: hit.matchType,
                    confidence:
                        hit.matchType === 'exact'
                            ? SyobocalTitleDictionary.EXACT_CONFIDENCE
                            : SyobocalTitleDictionary.CONTAIN_CONFIDENCE,
                };
            }
        }
        return null;
    }

    public async lookupEpisodeNumber(tid: number, recordedTitle: string): Promise<number | null> {
        const episodes = await this.db.listEpisodes(tid);
        if (episodes.length === 0) return null;
        const key = syobocalLookupKey(recordedTitle.normalize('NFKC'));
        if (key === '') return null;

        // サブタイトルが録画タイトルに含まれていれば、その話数とみなす。
        // 短いサブタイトルの偶然一致を避けるため最長のものを採用する
        let best: { episodeNumber: number; length: number } | null = null;
        for (const episode of episodes) {
            if (episode.lookupKey.length < SyobocalTitleDictionary.CONTAIN_MIN_KEY_LENGTH) continue;
            if (key.includes(episode.lookupKey) === false) continue;
            if (best === null || episode.lookupKey.length > best.length) {
                best = { episodeNumber: episode.episodeNumber, length: episode.lookupKey.length };
            }
        }
        return best?.episodeNumber ?? null;
    }

    public async getStatus(): Promise<SyobocalTitleDictionaryStatus> {
        return {
            titleCount: await this.db.count(),
            lastUpdate: await this.db.getLatestLastUpdate(),
            lastSyncedAt: this.lastSyncedAt,
            running: this.running,
            error: this.lastError,
        };
    }

    /**
     * 照合キー 1 件を辞書から引く (完全一致 → 含有マッチの順)
     */
    private lookupKey(
        key: string,
        index: Map<string, AliasIndexEntry>,
    ): { tid: number; matchType: 'exact' | 'contain' } | null {
        const exact = index.get(key);
        if (typeof exact !== 'undefined') return { tid: exact.tid, matchType: 'exact' };

        let best: { tid: number; rank: number; length: number } | null = null;
        for (const candidate of this.keysByLength) {
            // keysByLength は長さ降順。既に候補が見つかっていてそれより短いキーに入ったら打ち切る
            if (best !== null && candidate.length < best.length) break;
            if (key.includes(candidate) === false) continue;
            const entry = index.get(candidate);
            if (typeof entry === 'undefined') continue;
            // 同じ長さで競合した場合は rank (正式タイトル > 略称/英題 > Keywords) の小さい方を採る
            if (best === null || entry.rank < best.rank) {
                best = { tid: entry.tid, rank: entry.rank, length: candidate.length };
            }
        }
        if (best === null) return null;
        if (best.length / key.length < SyobocalTitleDictionary.CONTAIN_MIN_RATIO) return null;
        return { tid: best.tid, matchType: 'contain' };
    }

    /**
     * DB から照合キー索引をメモリへ読み込む (作品数は 8000 程度なので全件保持して問題ない)
     * 構築済みでも INDEX_REVALIDATE_MS 経過後は件数・更新日時を確認し、変化していれば作り直す
     */
    private async ensureIndex(): Promise<Map<string, AliasIndexEntry>> {
        if (this.aliasIndex !== null) {
            if (Date.now() - this.indexBuiltAt < SyobocalTitleDictionary.INDEX_REVALIDATE_MS) return this.aliasIndex;
            const signature = `${await this.db.count()}:${await this.db.getLatestLastUpdate()}`;
            this.indexBuiltAt = Date.now();
            if (signature === this.indexSignature) return this.aliasIndex;
        }

        const index = new Map<string, AliasIndexEntry>();
        for (const row of await this.db.listAllAliases()) {
            if (row.lookupKey.length < 2) continue;
            const current = index.get(row.lookupKey);
            if (typeof current === 'undefined' || row.rank < current.rank) {
                index.set(row.lookupKey, { tid: row.tid, rank: row.rank });
            }
        }
        this.aliasIndex = index;
        this.keysByLength = [...index.keys()]
            .filter(x => x.length >= SyobocalTitleDictionary.CONTAIN_MIN_KEY_LENGTH)
            .sort((a, b) => b.length - a.length);
        this.indexBuiltAt = Date.now();
        this.indexSignature = `${await this.db.count()}:${await this.db.getLatestLastUpdate()}`;
        return index;
    }

    /**
     * TitleLookup を叩く。cursor が指定されていればその日時以降の差分のみ取得する
     */
    private async fetch(cursor: string | null): Promise<string> {
        const params = new URLSearchParams({
            Command: 'TitleLookup',
            TID: '*',
            Fields: SyobocalTitleDictionary.FIELDS,
        });
        if (cursor !== null) params.set('LastUpdate', `${cursor.replace(/[-: ]/gu, '').replace(/^(\d{8})/u, '$1_')}-`);
        const response = await this.http.get(`${SyobocalTitleDictionary.BASE_URL}?${params.toString()}`, {
            timeoutMs: SyobocalTitleDictionary.FETCH_TIMEOUT_MS,
        });
        return response.text;
    }

    /**
     * TitleItem 1 件を DB 登録用の形へ変換する。タイトルが空、または照合キーが作れない作品は除外する
     */
    private toUpsert(row: Record<string, string>): SyobocalTitleUpsert | null {
        const tid = Number(row.TID);
        const title = (row.Title ?? '').trim();
        if (Number.isFinite(tid) === false || tid <= 0 || title === '') return null;
        const lookupKey = syobocalLookupKey(title);
        if (lookupKey.length < 2) return null;

        const episodes = SyobocalTitleDictionary.parseSubTitles(row.SubTitles).map(x => ({
            tid,
            episodeNumber: x.episodeNumber,
            subTitle: x.subTitle,
            lookupKey: syobocalLookupKey(x.subTitle),
        }));

        // 別名候補: ShortTitle / TitleEN は rank 1、Keywords (改行区切りの別名リスト) は rank 2
        const aliases = new Map<string, number>();
        const addAlias = (value: string | undefined, rank: number): void => {
            const key = syobocalLookupKey((value ?? '').trim());
            if (key.length < 2 || key === lookupKey) return;
            const current = aliases.get(key);
            if (typeof current === 'undefined' || rank < current) aliases.set(key, rank);
        };
        addAlias(row.ShortTitle, 1);
        addAlias(row.TitleEN, 1);
        for (const keyword of (row.Keywords ?? '').split(/\r?\n/u)) addAlias(keyword, 2);

        return {
            title: {
                tid,
                title,
                lookupKey,
                shortTitle: SyobocalTitleDictionary.textOrNull(row.ShortTitle),
                titleYomi: SyobocalTitleDictionary.textOrNull(row.TitleYomi),
                titleEn: SyobocalTitleDictionary.textOrNull(row.TitleEN),
                cat: SyobocalTitleDictionary.numberOrNull(row.Cat),
                firstYear: SyobocalTitleDictionary.numberOrNull(row.FirstYear),
                firstMonth: SyobocalTitleDictionary.numberOrNull(row.FirstMonth),
                totalEpisodes: episodes.length > 0 ? Math.max(...episodes.map(x => x.episodeNumber)) : null,
                lastUpdate: SyobocalTitleDictionary.textOrNull(row.LastUpdate),
                updatedAt: Date.now(),
            },
            aliases: [...aliases.entries()].map(([key, rank]) => ({ lookupKey: key, tid, rank })),
            episodes,
        };
    }

    /**
     * SubTitles ("*001*サブタイトル" が改行で並ぶ形式) を話数付きの配列へ変換する
     */
    private static parseSubTitles(value: string | undefined): Array<{ episodeNumber: number; subTitle: string }> {
        if (!value) return [];
        const result: Array<{ episodeNumber: number; subTitle: string }> = [];
        for (const line of value.split(/\r?\n/u)) {
            const match = line.match(/^\*(\d+)\*(.*)$/u);
            if (match === null) continue;
            const episodeNumber = Number(match[1]);
            const subTitle = match[2].trim();
            if (Number.isFinite(episodeNumber) === false || episodeNumber <= 0 || subTitle === '') continue;
            result.push({ episodeNumber, subTitle });
        }
        return result;
    }

    private static textOrNull(value: string | undefined): string | null {
        const text = (value ?? '').trim();
        return text === '' ? null : text;
    }

    private static numberOrNull(value: string | undefined): number | null {
        const parsed = Number(value);
        return value && Number.isFinite(parsed) ? parsed : null;
    }

    /**
     * 辞書機能が有効か (機能フラグ + しょぼいカレンダー連携の有効設定)
     */
    private async enabled(): Promise<boolean> {
        const config = this.config.getConfig();
        if (isFeatureEnabled(config, 'metadataProviders') === false) return false;
        const all = await this.settings.getAll();
        // 優先順位: DB (設定画面) > config.yml (metadataDefaults) > 既定 (無効)
        return resolveBoolean(
            (all.metadata as any)?.syobocal?.enabled,
            config.metadataDefaults?.syobocal?.enabled,
            false,
        );
    }

    private async syncIntervalMs(): Promise<number> {
        const all = await this.settings.getAll();
        return resolveNumber(
            (all.metadata as any)?.syobocal?.titleSyncIntervalMs,
            this.config.getConfig().metadataDefaults?.syobocal?.titleSyncIntervalMs,
            SyobocalTitleDictionary.DEFAULT_SYNC_INTERVAL_MS,
        );
    }
}
