import { inject, injectable } from 'inversify';
import IAnnictWorkDB from '../db/IAnnictWorkDB';
import ISyobocalTitleDB, { SyobocalTitleSeasonRecord } from '../db/ISyobocalTitleDB';
import IWikidataProgramDB from '../db/IWikidataProgramDB';
import { buildSeriesLookupKeys, seasonBaseKey, strictProgramKey, syobocalLookupKey } from './SeriesNormalizer';
import IWorkDictionary, { WorkMatch } from './IWorkDictionary';

// 同じ作品の期 (第 1 期 / 第 2 期 …) 1 件分。放送時期から期を選び直すために使う
interface SeasonEntry {
    tid: number;
    // 放送開始時刻 (firstYear/firstMonth の月初)。年が取れない作品は null
    startedAt: number | null;
    // 放送終了の目安 (開始 + 総話数分の週 + 余裕)。null は不明
    endedAt: number | null;
}

interface IndexEntry {
    // しょぼいカレンダー TID (Annict 単独作品では null)
    syobocalTid: number | null;
    // Annict 作品 ID (しょぼいカレンダー単独作品では null)
    annictId: number | null;
    // Wikidata 項目 ID (アニメ辞書単独の作品では null)
    wikidataQid: string | null;
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
    // 総話数が分からない作品の放送期間を見積もるときの話数 (1 クール)
    private static readonly DEFAULT_SEASON_EPISODES = 13;
    // 放送休止・特番による延びを見込んで放送期間に足す週数
    private static readonly SEASON_SLACK_WEEKS = 6;
    // 辞書横断検索 (search) のキーワード最短長と件数上限
    private static readonly SEARCH_MIN_KEYWORD_LENGTH = 2;
    private static readonly SEARCH_DEFAULT_LIMIT = 20;
    private static readonly SEARCH_MAX_LIMIT = 50;

    private index: Map<string, IndexEntry> | null = null;
    // Wikidata 由来の厳密キー索引。一般番組は短く一般的なタイトルが多く含有一致で誤爆するため、
    // 通常の索引とは分けて「完全一致でのみ引く」ようにする
    private strictIndex: Map<string, IndexEntry> = new Map();
    // 含有・前方マッチ用に長さ降順で並べた照合キー
    private keysByLength: string[] = [];
    private indexBuiltAt: number = 0;
    private indexSignature: string | null = null;
    // 作品情報の解決結果キャッシュ (バックフィルで同じ作品を何度も引くため)。索引再構築時に破棄する
    private matchCache: Map<string, WorkMatch | null> = new Map();
    // 「期表記を落とした基本キー」→ その作品の全期。2 件以上のグループだけを保持する
    private seasonGroups: Map<string, SeasonEntry[]> = new Map();
    // TID → 基本キー (引き当てた作品がどのグループに属するかを引く)
    private tidToSeasonBaseKey: Map<number, string> = new Map();

    constructor(
        @inject('ISyobocalTitleDB') private syobocalDB: ISyobocalTitleDB,
        @inject('IAnnictWorkDB') private annictDB: IAnnictWorkDB,
        @inject('IWikidataProgramDB') private wikidataDB: IWikidataProgramDB,
    ) {}

    public async lookup(recordedTitle: string, airedAt?: number): Promise<WorkMatch | null> {
        const index = await this.ensureIndex();
        if (index.size === 0 && this.strictIndex.size === 0) return null;

        // 1. アニメ辞書 (完全一致 → 含有 → 前方一致)
        for (const key of buildSeriesLookupKeys(recordedTitle)) {
            const hit = this.lookupKey(key, index);
            if (hit !== null) {
                const entry = this.resolveSeason(hit.entry, airedAt);
                const match = await this.toMatch(entry, hit.matchType);
                if (match !== null) return match;
            }
        }

        // 2. Wikidata の全ジャンル辞書。誤爆を避けるため厳密キーの完全一致のみを見る
        //    (装飾の除去は SeriesNormalizer / LLM 抽出の役目)
        const strictHit = this.strictIndex.get(strictProgramKey(recordedTitle.normalize('NFKC')));
        if (typeof strictHit !== 'undefined') return await this.toMatch(strictHit, 'exact');

        return null;
    }

    /**
     * キーワードで統合索引を横断検索する
     * @param keyword: string 検索キーワード
     * @param limit: number | undefined 最大件数 (既定 SEARCH_DEFAULT_LIMIT / 上限 SEARCH_MAX_LIMIT)
     * @return Promise<WorkMatch[]>
     */
    public async search(keyword: string, limit?: number): Promise<WorkMatch[]> {
        const index = await this.ensureIndex();
        const normalized = keyword.normalize('NFKC');
        const key = syobocalLookupKey(normalized);
        const strictKey = strictProgramKey(normalized);
        if (key.length < WorkDictionary.SEARCH_MIN_KEYWORD_LENGTH) return [];

        const max = Math.min(
            Math.max(
                typeof limit === 'number' && Number.isFinite(limit)
                    ? Math.floor(limit)
                    : WorkDictionary.SEARCH_DEFAULT_LIMIT,
                1,
            ),
            WorkDictionary.SEARCH_MAX_LIMIT,
        );
        const seen = new Set<string>();
        const hits: Array<{ entry: IndexEntry; matchType: WorkMatch['matchType']; length: number }> = [];
        const push = (entry: IndexEntry, candidate: string, needle: string): void => {
            // 同一作品が複数の照合キーで引っかかるので、外部 ID の組で重複を落とす
            const signature = `${entry.syobocalTid ?? ''}:${entry.annictId ?? ''}:${entry.wikidataQid ?? ''}`;
            if (seen.has(signature)) return;
            seen.add(signature);
            hits.push({
                entry,
                matchType: candidate === needle ? 'exact' : candidate.startsWith(needle) ? 'prefix' : 'contain',
                length: candidate.length,
            });
        };

        // 1. アニメ辞書 (しょぼいカレンダー + Annict) の統合索引
        const exact = index.get(key);
        if (typeof exact !== 'undefined') push(exact, key, key);
        for (const candidate of this.keysByLength) {
            if (hits.length >= max) break;
            if (candidate.includes(key) === false) continue;
            const entry = index.get(candidate);
            if (typeof entry === 'undefined') continue;
            push(entry, candidate, key);
        }
        // 2. Wikidata 単独の番組 (厳密キー索引)
        if (strictKey.length >= WorkDictionary.SEARCH_MIN_KEYWORD_LENGTH) {
            for (const [candidate, entry] of this.strictIndex) {
                if (hits.length >= max) break;
                if (candidate.includes(strictKey) === false) continue;
                push(entry, candidate, strictKey);
            }
        }

        // 照合キーが短いものほどキーワードに近いので上位へ出す
        hits.sort((a, b) => a.length - b.length);
        const results: WorkMatch[] = [];
        for (const hit of hits.slice(0, max)) {
            const match = await this.toMatch(hit.entry, hit.matchType);
            if (match !== null) results.push(match);
        }
        return results;
    }

    /**
     * 外部 ID から辞書の作品を引く
     * @param ids: しょぼいカレンダー TID / Annict 作品 ID / Wikidata 項目 ID
     * @return Promise<WorkMatch | null>
     */
    public async findByIds(ids: {
        syobocalTid?: number | null;
        annictId?: number | null;
        wikidataQid?: string | null;
    }): Promise<WorkMatch | null> {
        return await this.toMatch(
            {
                syobocalTid: ids.syobocalTid ?? null,
                annictId: ids.annictId ?? null,
                wikidataQid: ids.wikidataQid ?? null,
                rank: 0,
            },
            'exact',
        );
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

    public async lookupEpisodeTitle(syobocalTid: number, episodeNumber: number): Promise<string | null> {
        if (Number.isFinite(episodeNumber) === false) return null;
        const episodes = await this.syobocalDB.listEpisodes(syobocalTid);
        return episodes.find(x => x.episodeNumber === episodeNumber)?.subTitle ?? null;
    }

    /**
     * 引き当てた作品に続編 (第 2 期など) がある場合、録画の放送日時に合う期へ差し替える。
     *
     * 局によっては「株式会社マジルミエ[字]」のように期の表記を送出しないため、
     * タイトル照合だけでは常に第 1 期 (期表記の無い作品) に当たってしまう。
     * しょぼいカレンダーは期ごとに別 TID + 初回放送年月を持つので、
     * 録画の放送日時がどの期の放送期間に入るかで選び直す。
     *
     * 放送予定照会 (SyobocalProgramLookup) が引ける局ではそちらが優先されるため、
     * これはしょぼいカレンダー未登録の局を救うための後段の判定になる。
     * 該当する期が 1 つに定まらない場合・放送日時が不明な場合は元のエントリをそのまま返す
     * @param entry: IndexEntry タイトル照合で引き当てたエントリ
     * @param airedAt: number | undefined 録画の放送開始時刻
     * @return IndexEntry
     */
    private resolveSeason(entry: IndexEntry, airedAt?: number): IndexEntry {
        if (typeof airedAt !== 'number' || Number.isFinite(airedAt) === false || entry.syobocalTid === null) {
            return entry;
        }
        const baseKey = this.tidToSeasonBaseKey.get(entry.syobocalTid);
        if (typeof baseKey === 'undefined') return entry;
        const group = this.seasonGroups.get(baseKey);
        if (typeof group === 'undefined') return entry;

        // 放送期間に入る期だけを候補にする。複数に当たる (期間が重なっている) 場合は
        // どれか 1 つに決められないので元のままにする
        const hits = group.filter(
            season =>
                season.startedAt !== null &&
                season.endedAt !== null &&
                season.startedAt <= airedAt &&
                airedAt <= season.endedAt,
        );
        if (hits.length !== 1) return entry;
        if (hits[0].tid === entry.syobocalTid) return entry;

        // 期を差し替えるので、別作品の Annict / Wikidata の ID は引き継がない
        return { syobocalTid: hits[0].tid, annictId: null, wikidataQid: null, rank: entry.rank };
    }

    /**
     * 索引のエントリから、表示用タイトル・総話数を解決して WorkMatch を組み立てる。
     * しょぼいカレンダー側の正式タイトルを優先し、Annict 単独作品では Annict のタイトルを使う
     */
    private async toMatch(entry: IndexEntry, matchType: WorkMatch['matchType']): Promise<WorkMatch | null> {
        const cacheKey = `${entry.syobocalTid ?? ''}:${entry.annictId ?? ''}:${entry.wikidataQid ?? ''}:${matchType}`;
        const cached = this.matchCache.get(cacheKey);
        if (typeof cached !== 'undefined') return cached;
        const syobocal = entry.syobocalTid === null ? null : await this.syobocalDB.get(entry.syobocalTid);
        const annict = entry.annictId === null ? null : await this.annictDB.get(entry.annictId);
        const wikidata = entry.wikidataQid === null ? null : await this.wikidataDB.get(entry.wikidataQid);
        const title = syobocal?.title ?? annict?.title ?? wikidata?.title ?? null;
        if (title === null) {
            this.matchCache.set(cacheKey, null);
            return null;
        }

        const match: WorkMatch = {
            syobocalTid: syobocal?.tid ?? null,
            annictId: annict?.annictId ?? null,
            wikidataQid: wikidata?.qid ?? null,
            tmdbId: wikidata?.tmdbId ?? null,
            title,
            // 読み仮名はしょぼいカレンダーの TitleYomi を優先し、無ければ Annict の titleKana を使う
            titleKana: syobocal?.titleYomi ?? annict?.titleKana ?? null,
            // クールは Annict の seasonYear/seasonName を優先し、
            // 無ければしょぼいカレンダーの初回放送年月から導出する
            seasonYear: annict?.seasonYear ?? syobocal?.firstYear ?? null,
            seasonName:
                WorkDictionary.normalizeSeasonName(annict?.seasonName) ??
                WorkDictionary.seasonFromMonth(syobocal?.firstMonth ?? null),
            // 総話数はしょぼいカレンダーのサブタイトル数を優先し、無ければ Annict の episodesCount を使う
            totalEpisodes: syobocal?.totalEpisodes ?? annict?.episodesCount ?? null,
            matchType,
            confidence:
                matchType === 'exact'
                    ? WorkDictionary.EXACT_CONFIDENCE
                    : matchType === 'contain'
                      ? WorkDictionary.CONTAIN_CONFIDENCE
                      : WorkDictionary.PREFIX_CONFIDENCE,
            source: syobocal !== null ? 'syobocal' : annict !== null ? 'annict' : 'wikidata',
        };
        this.matchCache.set(cacheKey, match);
        return match;
    }

    /**
     * Annict の seasonName を内部表現へ正規化する (想定外の値は null)
     */
    private static normalizeSeasonName(value: string | null | undefined): WorkMatch['seasonName'] {
        const upper = (value ?? '').toUpperCase();
        return upper === 'WINTER' || upper === 'SPRING' || upper === 'SUMMER' || upper === 'AUTUMN' ? upper : null;
    }

    /**
     * 初回放送月からクールを導出する (1-3 冬 / 4-6 春 / 7-9 夏 / 10-12 秋)
     */
    private static seasonFromMonth(month: number | null): WorkMatch['seasonName'] {
        if (month === null || Number.isFinite(month) === false) return null;
        if (month >= 1 && month <= 3) return 'WINTER';
        if (month >= 4 && month <= 6) return 'SPRING';
        if (month >= 7 && month <= 9) return 'SUMMER';
        if (month >= 10 && month <= 12) return 'AUTUMN';
        return null;
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
                index.set(key, {
                    ...entry,
                    syobocalTid: entry.syobocalTid ?? current.syobocalTid,
                    annictId: entry.annictId ?? current.annictId,
                });
            } else {
                current.syobocalTid = current.syobocalTid ?? entry.syobocalTid;
                current.annictId = current.annictId ?? entry.annictId;
            }
        };

        // 1. しょぼいカレンダー辞書
        for (const row of await this.syobocalDB.listAllAliases()) {
            put(row.lookupKey, { syobocalTid: row.tid, annictId: null, wikidataQid: null, rank: row.rank });
        }
        // 2. Annict 辞書。syobocalTid を持つ作品は同じ作品として TID を併記する
        //    (これによりしょぼいカレンダー側の正式タイトルと Annict の英題が同一作品へ寄る)
        for (const row of await this.annictDB.listAllAliases()) {
            put(row.lookupKey, {
                syobocalTid: row.syobocalTid,
                annictId: row.annictId,
                wikidataQid: null,
                rank: row.rank,
            });
        }

        // 3. Wikidata 辞書 (全ジャンル)。P11648 で結び付く番組はアニメ辞書側の作品と同一視し、
        //    新しい作品としては増やさない (既存エントリへ qid を併記するだけ)。
        //    アニメ辞書に無い番組だけが Wikidata 単独エントリとして厳密キー索引へ入る
        const strictIndex = new Map<string, IndexEntry>();
        const tidToEntry = new Map<number, IndexEntry>();
        for (const entry of index.values()) {
            if (entry.syobocalTid !== null && tidToEntry.has(entry.syobocalTid) === false) {
                tidToEntry.set(entry.syobocalTid, entry);
            }
        }
        for (const row of await this.wikidataDB.listAllAliases()) {
            if (row.strictKey.length < 2) continue;
            const linked = row.syobocalTid === null ? undefined : tidToEntry.get(row.syobocalTid);
            if (typeof linked !== 'undefined') {
                // 既存 (しょぼいカレンダー / Annict) の作品と同一。qid を補うだけで作品は増やさない
                linked.wikidataQid = linked.wikidataQid ?? row.qid;
                continue;
            }
            const current = strictIndex.get(row.strictKey);
            if (typeof current === 'undefined' || row.rank < current.rank) {
                strictIndex.set(row.strictKey, {
                    syobocalTid: row.syobocalTid,
                    annictId: null,
                    wikidataQid: row.qid,
                    rank: row.rank,
                });
            }
        }

        // 4. 続編 (期) のグループ。「株式会社マジルミエ」と「株式会社マジルミエ(第2期)」のように
        //    基本キーが同じ作品をまとめ、放送時期から期を選び直せるようにする
        this.buildSeasonGroups(await this.syobocalDB.listSeasons());

        this.index = index;
        this.strictIndex = strictIndex;
        this.matchCache.clear();
        this.keysByLength = [...index.keys()]
            .filter(x => x.length >= WorkDictionary.MIN_KEY_LENGTH)
            .sort((a, b) => b.length - a.length);
        this.indexBuiltAt = Date.now();
        this.indexSignature = await this.signature();
        return index;
    }

    /**
     * 続編 (期) のグループを構築する。
     * 期表記を落とした基本キーが同じ作品を 1 グループにまとめ、各期の放送期間を推定して持つ。
     * 期が 1 つしか無い作品は選び直す余地が無いのでグループに含めない
     * @param seasons: しょぼいカレンダー辞書の作品一覧 (照合キー + 初回放送年月 + 総話数)
     */
    private buildSeasonGroups(seasons: SyobocalTitleSeasonRecord[]): void {
        const groups = new Map<string, SeasonEntry[]>();
        const tidToBaseKey = new Map<number, string>();
        for (const row of seasons) {
            if (typeof row.lookupKey !== 'string' || row.lookupKey.length < 2) continue;
            const baseKey = seasonBaseKey(row.lookupKey);
            if (baseKey.length < WorkDictionary.MIN_KEY_LENGTH) continue;
            const startedAt = WorkDictionary.seasonStartedAt(row.firstYear, row.firstMonth);
            const entry: SeasonEntry = {
                tid: row.tid,
                startedAt,
                endedAt: WorkDictionary.seasonEndedAt(startedAt, row.totalEpisodes),
            };
            const current = groups.get(baseKey);
            if (typeof current === 'undefined') groups.set(baseKey, [entry]);
            else current.push(entry);
            tidToBaseKey.set(row.tid, baseKey);
        }

        this.seasonGroups = new Map([...groups].filter(([, entries]) => entries.length > 1));
        this.tidToSeasonBaseKey = new Map([...tidToBaseKey].filter(([, baseKey]) => this.seasonGroups.has(baseKey)));
    }

    /**
     * 初回放送年月から放送開始時刻 (その月の 1 日) を作る
     * @param year: number | null
     * @param month: number | null
     * @return number | null 年が取れない場合は null
     */
    private static seasonStartedAt(year: number | null, month: number | null): number | null {
        if (typeof year !== 'number' || Number.isFinite(year) === false || year < 1950) return null;
        const m = typeof month === 'number' && month >= 1 && month <= 12 ? month : 1;

        return new Date(year, m - 1, 1).getTime();
    }

    /**
     * 放送終了の目安を作る。総話数分の週数に、放送休止・特番による延びを見込んだ余裕を足す。
     * 総話数が不明な作品は 1 クール放送とみなす
     * @param startedAt: number | null
     * @param totalEpisodes: number | null
     * @return number | null
     */
    private static seasonEndedAt(startedAt: number | null, totalEpisodes: number | null): number | null {
        if (startedAt === null) return null;
        const episodes =
            typeof totalEpisodes === 'number' && totalEpisodes > 0
                ? totalEpisodes
                : WorkDictionary.DEFAULT_SEASON_EPISODES;

        return startedAt + (episodes + WorkDictionary.SEASON_SLACK_WEEKS) * 7 * 24 * 60 * 60 * 1000;
    }

    /**
     * 索引の再構築要否を判断するための、辞書の内容を表す署名
     */
    private async signature(): Promise<string> {
        return `${await this.syobocalDB.count()}:${await this.syobocalDB.getLatestLastUpdate()}:${await this.annictDB.count()}:${await this.wikidataDB.count()}`;
    }
}
