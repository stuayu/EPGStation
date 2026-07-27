import { inject, injectable } from 'inversify';
import IAnnictWorkDB from '../db/IAnnictWorkDB';
import ISyobocalTitleDB from '../db/ISyobocalTitleDB';
import { buildSeriesLookupKeys, syobocalLookupKey } from './SeriesNormalizer';
import IWorkDictionary, { WorkMatch } from './IWorkDictionary';

interface IndexEntry {
    // しょぼいカレンダー TID (Annict 単独作品では null)
    syobocalTid: number | null;
    // Annict 作品 ID (しょぼいカレンダー単独作品では null)
    annictId: number | null;
    // 0: 正式タイトル / 1: 略称・英題 / 2: 別名・かな・ローマ字
    rank: number;
}

/**
 * しょぼいカレンダー辞書と Annict 辞書を統合し、録画番組タイトルから作品を特定する。
 *
 * 2 つの辞書は補完関係にあるため、片方だけを引くのではなく統合した 1 つの索引を作って引く
 * (含有マッチで「最長の辞書キーを採る」判定が、辞書をまたいで正しく効くようにするため)。
 * Annict 作品が syobocalTid を持つ場合は同一作品として 1 エントリに統合するので、
 * 「しょぼいカレンダーの正式タイトル + Annict の英題/ローマ字/かな」がすべて同じ作品の
 * 照合キーになる。
 *
 * 照合手順:
 *  1. 完全一致 (確度 1.0)
 *  2. 含有一致 — 辞書キーが録画キーに含まれる最長のもの (確度 0.95)。
 *     枠名など余分な語が付いた録画タイトル向け。長さ比 0.5 以上を要求して誤爆を防ぐ
 *  3. 前方一致 — 録画キーが辞書キーの先頭に一致 (確度 0.9)。
 *     EPG の文字数制限で末尾が切れたタイトル ("SAKAMOTO" → "SAKAMOTO DAYS") 向け
 */
@injectable()
export default class WorkDictionary implements IWorkDictionary {
    // 含有・前方マッチで採用する最短の辞書キー長 (これ未満は偶然の一致が多すぎる)
    private static readonly MIN_KEY_LENGTH = 3;
    // 含有マッチで要求する「辞書キー長 / 録画キー長」の下限
    private static readonly CONTAIN_MIN_RATIO = 0.5;
    // 前方一致マッチで要求する「録画キー長 / 辞書キー長」の下限と、録画キーの最短長
    private static readonly PREFIX_MIN_RATIO = 0.6;
    private static readonly PREFIX_MIN_KEY_LENGTH = 6;
    private static readonly EXACT_CONFIDENCE = 1;
    private static readonly CONTAIN_CONFIDENCE = 0.95;
    private static readonly PREFIX_CONFIDENCE = 0.9;
    // メモリ上の索引を DB と突き合わせ直す間隔 (ms)。
    // 辞書は Operator の自動同期と Service の「今すぐ同期」の双方から更新されうる
    private static readonly INDEX_REVALIDATE_MS = 5 * 60 * 1000;

    private index: Map<string, IndexEntry> | null = null;
    // 含有・前方マッチ用に長さ降順で並べた照合キー
    private keysByLength: string[] = [];
    private indexBuiltAt: number = 0;
    private indexSignature: string | null = null;
    // 作品情報の解決結果キャッシュ (バックフィルで同じ作品を何度も引くため)。索引再構築時に破棄する
    private matchCache: Map<string, WorkMatch | null> = new Map();

    constructor(
        @inject('ISyobocalTitleDB') private syobocalDB: ISyobocalTitleDB,
        @inject('IAnnictWorkDB') private annictDB: IAnnictWorkDB,
    ) {}

    public async lookup(recordedTitle: string): Promise<WorkMatch | null> {
        const index = await this.ensureIndex();
        if (index.size === 0) return null;

        for (const key of buildSeriesLookupKeys(recordedTitle)) {
            const hit = this.lookupKey(key, index);
            if (hit !== null) {
                const match = await this.toMatch(hit.entry, hit.matchType);
                if (match !== null) return match;
            }
        }
        return null;
    }

    public async lookupEpisodeNumber(syobocalTid: number, recordedTitle: string): Promise<number | null> {
        const episodes = await this.syobocalDB.listEpisodes(syobocalTid);
        if (episodes.length === 0) return null;
        const key = syobocalLookupKey(recordedTitle.normalize('NFKC'));
        if (key === '') return null;

        // サブタイトルが録画タイトルに含まれていれば、その話数とみなす。
        // 短いサブタイトルの偶然一致を避けるため最長のものを採用する
        let best: { episodeNumber: number; length: number } | null = null;
        for (const episode of episodes) {
            if (episode.lookupKey.length < WorkDictionary.MIN_KEY_LENGTH) continue;
            if (key.includes(episode.lookupKey) === false) continue;
            if (best === null || episode.lookupKey.length > best.length) {
                best = { episodeNumber: episode.episodeNumber, length: episode.lookupKey.length };
            }
        }
        return best?.episodeNumber ?? null;
    }

    /**
     * 索引のエントリから、表示用タイトル・総話数を解決して WorkMatch を組み立てる。
     * しょぼいカレンダー側の正式タイトルを優先し、Annict 単独作品では Annict のタイトルを使う
     */
    private async toMatch(entry: IndexEntry, matchType: WorkMatch['matchType']): Promise<WorkMatch | null> {
        const cacheKey = `${entry.syobocalTid ?? ''}:${entry.annictId ?? ''}:${matchType}`;
        const cached = this.matchCache.get(cacheKey);
        if (typeof cached !== 'undefined') return cached;
        const syobocal = entry.syobocalTid === null ? null : await this.syobocalDB.get(entry.syobocalTid);
        const annict = entry.annictId === null ? null : await this.annictDB.get(entry.annictId);
        const title = syobocal?.title ?? annict?.title ?? null;
        if (title === null) {
            this.matchCache.set(cacheKey, null);
            return null;
        }

        const match: WorkMatch = {
            syobocalTid: syobocal?.tid ?? null,
            annictId: annict?.annictId ?? null,
            title,
            // 総話数はしょぼいカレンダーのサブタイトル数を優先し、無ければ Annict の episodesCount を使う
            totalEpisodes: syobocal?.totalEpisodes ?? annict?.episodesCount ?? null,
            matchType,
            confidence:
                matchType === 'exact'
                    ? WorkDictionary.EXACT_CONFIDENCE
                    : matchType === 'contain'
                      ? WorkDictionary.CONTAIN_CONFIDENCE
                      : WorkDictionary.PREFIX_CONFIDENCE,
            source: syobocal !== null ? 'syobocal' : 'annict',
        };
        this.matchCache.set(cacheKey, match);
        return match;
    }

    /**
     * 照合キー 1 件を索引から引く (完全一致 → 含有一致 → 前方一致の順)
     */
    private lookupKey(
        key: string,
        index: Map<string, IndexEntry>,
    ): { entry: IndexEntry; matchType: WorkMatch['matchType'] } | null {
        const exact = index.get(key);
        if (typeof exact !== 'undefined') return { entry: exact, matchType: 'exact' };

        // 含有一致: 辞書キーが録画キーに含まれる最長のもの
        let best: { entry: IndexEntry; length: number; rank: number } | null = null;
        for (const candidate of this.keysByLength) {
            // keysByLength は長さ降順。既に候補があってそれより短いキーに入ったら打ち切る
            if (best !== null && candidate.length < best.length) break;
            if (key.includes(candidate) === false) continue;
            const entry = index.get(candidate);
            if (typeof entry === 'undefined') continue;
            // 同じ長さで競合した場合は rank (正式タイトル > 略称/英題 > 別名) の小さい方を採る
            if (best === null || entry.rank < best.rank) {
                best = { entry, length: candidate.length, rank: entry.rank };
            }
        }
        if (best !== null && best.length / key.length >= WorkDictionary.CONTAIN_MIN_RATIO) {
            return { entry: best.entry, matchType: 'contain' };
        }

        // 前方一致: EPG の文字数制限で末尾が切れた録画タイトル。最短の辞書キーを採る
        if (key.length >= WorkDictionary.PREFIX_MIN_KEY_LENGTH) {
            let prefix: { entry: IndexEntry; length: number; rank: number } | null = null;
            for (const candidate of this.keysByLength) {
                if (candidate.length <= key.length) break; // 長さ降順なので、以降はすべて短い
                if (candidate.startsWith(key) === false) continue;
                const entry = index.get(candidate);
                if (typeof entry === 'undefined') continue;
                if (
                    prefix === null ||
                    entry.rank < prefix.rank ||
                    (entry.rank === prefix.rank && candidate.length < prefix.length)
                ) {
                    prefix = { entry, length: candidate.length, rank: entry.rank };
                }
            }
            if (prefix !== null && key.length / prefix.length >= WorkDictionary.PREFIX_MIN_RATIO) {
                return { entry: prefix.entry, matchType: 'prefix' };
            }
        }
        return null;
    }

    /**
     * 2 つの辞書から統合索引をメモリへ構築する。
     * 構築済みでも INDEX_REVALIDATE_MS 経過後は件数を確認し、変化していれば作り直す
     */
    private async ensureIndex(): Promise<Map<string, IndexEntry>> {
        if (this.index !== null) {
            if (Date.now() - this.indexBuiltAt < WorkDictionary.INDEX_REVALIDATE_MS) return this.index;
            this.indexBuiltAt = Date.now();
            if ((await this.signature()) === this.indexSignature) return this.index;
        }

        const index = new Map<string, IndexEntry>();
        const put = (key: string, entry: IndexEntry): void => {
            if (key.length < 2) return;
            const current = index.get(key);
            if (typeof current === 'undefined') {
                index.set(key, entry);
                return;
            }
            // 同じキーに複数作品が来た場合は rank の小さい方 (正式タイトル由来) を優先する。
            // 同順位なら既存を保ち、しょぼいカレンダー側の情報を Annict 側で補完する
            if (entry.rank < current.rank) {
                index.set(key, { ...entry, syobocalTid: entry.syobocalTid ?? current.syobocalTid, annictId: entry.annictId ?? current.annictId });
            } else {
                current.syobocalTid = current.syobocalTid ?? entry.syobocalTid;
                current.annictId = current.annictId ?? entry.annictId;
            }
        };

        // 1. しょぼいカレンダー辞書
        for (const row of await this.syobocalDB.listAllAliases()) {
            put(row.lookupKey, { syobocalTid: row.tid, annictId: null, rank: row.rank });
        }
        // 2. Annict 辞書。syobocalTid を持つ作品は同じ作品として TID を併記する
        //    (これによりしょぼいカレンダー側の正式タイトルと Annict の英題が同一作品へ寄る)
        for (const row of await this.annictDB.listAllAliases()) {
            put(row.lookupKey, { syobocalTid: row.syobocalTid, annictId: row.annictId, rank: row.rank });
        }

        this.index = index;
        this.matchCache.clear();
        this.keysByLength = [...index.keys()]
            .filter(x => x.length >= WorkDictionary.MIN_KEY_LENGTH)
            .sort((a, b) => b.length - a.length);
        this.indexBuiltAt = Date.now();
        this.indexSignature = await this.signature();
        return index;
    }

    /**
     * 索引の再構築要否を判断するための、辞書の内容を表す署名
     */
    private async signature(): Promise<string> {
        return `${await this.syobocalDB.count()}:${await this.syobocalDB.getLatestLastUpdate()}:${await this.annictDB.count()}`;
    }
}
