import { inject, injectable } from 'inversify';
import { resolveBoolean, resolveNumber } from '../../AppSettingResolver';
import { isFeatureEnabled } from '../../FeatureFlags';
import IAppSettingDB from '../../db/IAppSettingDB';
import ISyobocalTitleDB, { SyobocalTitleUpsert } from '../../db/ISyobocalTitleDB';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import { syobocalLookupKey } from '../../series/SeriesNormalizer';
import IMetadataEndpointResolver from '../IMetadataEndpointResolver';
import IProviderHttpClient from '../IProviderHttpClient';
import ISyobocalTitleDictionary, {
    SyobocalTitleDictionaryStatus,
    SyobocalTitleSyncOption,
    SyobocalTitleSyncResult,
} from './ISyobocalTitleDictionary';
import { assertSyobocalResponse, xmlItems } from './SyobocalXml';

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
    // 取得するフィールド。Comment (あらすじ・スタッフ) は巨大で用途が無いため取得しない (全件 24MB → 9.5MB)
    private static readonly FIELDS =
        'TID,Title,ShortTitle,TitleYomi,TitleEN,Keywords,Cat,FirstYear,FirstMonth,SubTitles,LastUpdate';
    // 全件取得は 10MB 近い XML を受けるため長めのタイムアウトを取る
    private static readonly FETCH_TIMEOUT_MS = 180 * 1000;
    private static readonly DEFAULT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
    // 起動直後は EPG 更新などと重なるため少し遅らせてから初回同期する
    private static readonly INITIAL_SYNC_DELAY_MS = 60 * 1000;

    private log: ILogger;
    private running: boolean = false;
    private autoSyncTimer: NodeJS.Timeout | null = null;
    private lastSyncedAt: number | null = null;
    private lastError: string | null = null;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IProviderHttpClient') private http: IProviderHttpClient,
        @inject('ISyobocalTitleDB') private db: ISyobocalTitleDB,
        @inject('IAppSettingDB') private settings: IAppSettingDB,
        @inject('IConfiguration') private config: IConfiguration,
        @inject('IMetadataEndpointResolver') private endpoints: IMetadataEndpointResolver,
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

    public async getStatus(): Promise<SyobocalTitleDictionaryStatus> {
        return {
            titleCount: await this.db.count(),
            lastUpdate: await this.db.getLatestLastUpdate(),
            lastSyncedAt: this.lastSyncedAt,
            running: this.running,
            error: this.lastError,
        };
    }

    public async fetchComment(tid: number): Promise<string | null> {
        if (Number.isFinite(tid) === false || tid <= 0) {
            this.log.system.debug(`syobocal title dictionary: skip fetching a comment for an invalid TID (${tid})`);

            return null;
        }
        if ((await this.enabled()) === false) {
            this.log.system.debug(
                `syobocal title dictionary: skip fetching the comment of TID ${tid} (syobocal integration is disabled)`,
            );

            return null;
        }

        try {
            const params = new URLSearchParams({ Command: 'TitleLookup', TID: String(tid), Fields: 'TID,Comment' });
            const baseUrl = await this.endpoints.resolve('syobocal');
            const url = `${baseUrl}?${params.toString()}`;
            const xml = (await this.http.get(url)).text;
            // Cloudflare のレート制限などで XML 以外が返った場合は「コメント無し」と誤認しない
            assertSyobocalResponse(xml, 'TitleLookupResponse');
            const items = xmlItems(xml, 'TitleItem');
            const comment = SyobocalTitleDictionary.textOrNull(items[0]?.Comment);
            if (comment === null) {
                // 「コメントが本当に空」なのか「レスポンスを読めていない」のかを切り分けられるようにする
                this.log.system.warn(
                    `syobocal title dictionary: no comment for TID ${tid}` +
                        ` (TitleItem ${items.length} 件, レスポンス ${xml.length} bytes, url=${url})`,
                );
            } else {
                this.log.system.info(
                    `syobocal title dictionary: fetched the comment of TID ${tid} (${comment.length} chars)`,
                );
            }

            return comment;
        } catch (err) {
            this.log.system.warn(`syobocal title dictionary: failed to fetch the comment of TID ${tid}`);
            this.log.system.warn(err);
            return null;
        }
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
        const baseUrl = await this.endpoints.resolve('syobocal');
        const response = await this.http.get(`${baseUrl}?${params.toString()}`, {
            timeoutMs: SyobocalTitleDictionary.FETCH_TIMEOUT_MS,
        });
        // XML 以外が返っていた場合に「0 件同期」で成功扱いにしないよう、ここで弾く
        assertSyobocalResponse(response.text, 'TitleLookupResponse');

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
