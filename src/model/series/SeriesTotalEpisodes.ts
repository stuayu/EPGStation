import { inject, injectable } from 'inversify';
import Series from '../../db/entities/Series';
import IAnnictWorkDB from '../db/IAnnictWorkDB';
import ISyobocalTitleDB from '../db/ISyobocalTitleDB';
import { isFeatureEnabled } from '../FeatureFlags';
import IConfiguration from '../IConfiguration';
import ISeriesTotalEpisodes from './ISeriesTotalEpisodes';

/**
 * シリーズの「放送予定総話数」を解決するモデル。
 *
 * 欠番検出 (SeriesContinuity) は総話数が分からないと「観測済みの最大話数まで」しか見られず、
 * 最終話が録れていないシリーズの欠番を取りこぼす。総話数は series.totalEpisodes に入って
 * いることもあるが、辞書同期前に作られたシリーズでは null のままなので、
 * **ローカルに取り込んである外部辞書 (しょぼいカレンダー / Annict) から引き直す**。
 *
 * 外部への HTTP は行わず、同期済みの `syobocal_title` / `annict_work` を引くだけなので
 * 一覧表示のような件数の多い経路からも呼べる (結果は短時間キャッシュする)
 */
@injectable()
export default class SeriesTotalEpisodes implements ISeriesTotalEpisodes {
    private static readonly CACHE_TTL_MS = 10 * 60 * 1000;
    private static readonly CACHE_MAX_ENTRIES = 2000;

    private cache: Map<string, { value: number | null; expiresAt: number }> = new Map();

    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('ISyobocalTitleDB') private syobocalTitleDB: ISyobocalTitleDB,
        @inject('IAnnictWorkDB') private annictWorkDB: IAnnictWorkDB,
    ) {}

    public async resolve(series: Series): Promise<Record<number, number> | undefined> {
        // 手動で総話数を設定したシリーズはその値を尊重する (画面から欠番検出用に指定できる)
        if (typeof series.totalEpisodes === 'number' && series.totalEpisodes > 0) {
            return { 1: series.totalEpisodes };
        }
        const fromDictionary = await this.fromDictionary(series);

        // メタデータ側はシーズン区分を持たないため、簡易的に season 1 の総話数として扱う (既知の制約)
        return fromDictionary === null ? undefined : { 1: fromDictionary };
    }

    public async resolveMany(seriesList: Series[]): Promise<Map<number, Record<number, number>>> {
        const result = new Map<number, Record<number, number>>();
        for (const series of seriesList) {
            const total = await this.resolve(series).catch(() => undefined);
            if (typeof total !== 'undefined') result.set(series.id, total);
        }

        return result;
    }

    /**
     * 同期済みの外部辞書から総話数を引く。しょぼいカレンダー (サブタイトル数由来) を優先し、
     * 無ければ Annict の episodesCount を使う
     * @param series: Series
     * @return Promise<number | null>
     */
    private async fromDictionary(series: Series): Promise<number | null> {
        if (isFeatureEnabled(this.config.getConfig(), 'metadataProviders') === false) return null;

        if (typeof series.syobocalTid === 'number') {
            const total = await this.cached(`s:${series.syobocalTid}`, async () => {
                const title = await this.syobocalTitleDB.get(series.syobocalTid as number).catch(() => null);

                return title?.totalEpisodes ?? null;
            });
            if (total !== null) return total;
        }

        const annictId = series.annictId === null ? NaN : Number(series.annictId);
        if (Number.isFinite(annictId) && annictId > 0) {
            const total = await this.cached(`a:${annictId}`, async () => {
                const work = await this.annictWorkDB.get(annictId).catch(() => null);

                return work?.episodesCount ?? null;
            });
            if (total !== null) return total;
        }

        return null;
    }

    /**
     * 辞書引きの結果を一定時間キャッシュする (一覧表示で同じ作品を何度も引かないため)
     * @param key: string
     * @param load: () => Promise<number | null>
     * @return Promise<number | null>
     */
    private async cached(key: string, load: () => Promise<number | null>): Promise<number | null> {
        const now = Date.now();
        const hit = this.cache.get(key);
        if (typeof hit !== 'undefined' && hit.expiresAt > now) return hit.value;

        const value = await load();
        this.cache.set(key, {
            value: value !== null && value > 0 ? value : null,
            expiresAt: now + SeriesTotalEpisodes.CACHE_TTL_MS,
        });
        this.evict(now);

        return value !== null && value > 0 ? value : null;
    }

    private evict(now: number): void {
        for (const [key, entry] of this.cache) {
            if (entry.expiresAt <= now) this.cache.delete(key);
        }
        while (this.cache.size > SeriesTotalEpisodes.CACHE_MAX_ENTRIES) {
            const oldest = this.cache.keys().next();
            if (oldest.done === true) break;
            this.cache.delete(oldest.value);
        }
    }
}
