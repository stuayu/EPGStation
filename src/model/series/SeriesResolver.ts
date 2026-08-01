import { inject, injectable } from 'inversify';
import RecordedSeriesLink from '../../db/entities/RecordedSeriesLink';
import Series from '../../db/entities/Series';
import { resolveNumber } from '../AppSettingResolver';
import { isFeatureEnabled } from '../FeatureFlags';
import IConfiguration from '../IConfiguration';
import IAppSettingDB from '../db/IAppSettingDB';
import ISeriesDB from '../db/ISeriesDB';
import ISyobocalProgramLookup, { SyobocalProgramMatch } from '../metadata/syobocal/ISyobocalProgramLookup';
import INotificationDispatcher from '../notification/INotificationDispatcher';
import ILlmTitleExtractor from './ILlmTitleExtractor';
import IWorkDictionary, { WorkMatch } from './IWorkDictionary';
import ISeriesResolver, { SeriesRecordingInput, SeriesResolveTrace } from './ISeriesResolver';
import {
    displaySeriesTitle,
    isDerivedFromTitle,
    normalizeSeriesTitle,
    parseSeriesInfo,
    syobocalLookupKey,
} from './SeriesNormalizer';
export function titleSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const pairs = (s: string) => Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2));
    const right = pairs(b);
    let hits = 0;
    for (const pair of pairs(a)) {
        const i = right.indexOf(pair);
        if (i >= 0) {
            hits++;
            right.splice(i, 1);
        }
    }
    return (2 * hits) / (a.length + b.length - 2);
}
/**
 * タイトル類似度と局一致からスコアを算出する
 * 完全一致 (正規化タイトルが一致) は必ず 1.0 を返す (同一タイトルへの再解決が閾値未満になって
 * 別シリーズへ分裂するのを防ぐ)。完全一致以外は 0.99 を上限とし、あいまい一致だけで
 * しきい値 1.0 に到達してしまう (=無限にシリーズが増える) ことを防ぐ
 * @param normalizedTitle: string
 * @param candidate: Series
 * @param channelId: number
 * @return number 0〜1
 */
export function scoreCandidate(normalizedTitle: string, candidate: Series, channelId: number): number {
    if (normalizedTitle === candidate.normalizedTitle) return 1;
    const similarity = titleSimilarity(normalizedTitle, candidate.normalizedTitle);
    const channelBonus = candidate.preferredChannelId === channelId ? 0.08 : 0;
    return Math.min(0.99, similarity * 0.9 + channelBonus);
}
/**
 * 作品辞書のどちらで確定したかを RecordedSeriesLink.matchMethod へ写す
 * @param match: WorkMatch
 * @return RecordedSeriesLink['matchMethod']
 */
function matchMethodOf(match: WorkMatch): RecordedSeriesLink['matchMethod'] {
    return match.source === 'syobocal' ? 'syobocal' : match.source === 'annict' ? 'annict' : 'wikidata';
}
// 放送予定から引けた作品名が録画タイトルと「明らかに別物」と判定するしきい値。
// 局が独自表記で送出している録画も救うのが放送予定照会の目的なので、完全一致は求めず
// 「共通する部分が皆無」なものだけを弾く緩い値にしている
const PROGRAM_TITLE_MIN_SIMILARITY = 0.25;

/**
 * 放送予定から引けた作品名が、録画のタイトルとして妥当かを判定する。
 *
 * 放送予定は局と時刻だけで引くため、放送予定側の時刻ずれ・録画マージン・キー局の代用によって
 * 隣の番組や別番組を拾うことがある。作品名と録画タイトルに共通部分が皆無な場合は
 * その取り違えとみなしてスキップし、後続の判定 (エイリアス → 作品辞書 → …) へ委ねる
 * @param recordedTitle: string 録画番組タイトル
 * @param workTitle: string 放送予定から引けた作品名
 * @return boolean 妥当なら true
 */
export function isPlausibleProgramTitle(recordedTitle: string, workTitle: string): boolean {
    const recorded = syobocalLookupKey(recordedTitle.normalize('NFKC'));
    const work = syobocalLookupKey(workTitle);
    // 記号だけのタイトルなどで照合キーを作れない場合は判定材料が無いので通す
    if (recorded === '' || work === '') return true;
    // 作品名が録画タイトルに含まれる (通常) / 録画タイトルが略称になっている、のどちらかなら妥当
    if (recorded.includes(work) || work.includes(recorded)) return true;

    return titleSimilarity(recorded, work) >= PROGRAM_TITLE_MIN_SIMILARITY;
}

/**
 * 放送予定の照会結果から作品確定の確度を決める。
 * 取り違えの余地が小さい順に「番組の頭から録画できている」>「放送時間帯の包含で拾った」
 * >「未登録局を系列キー局で代用した」となる
 * @param program: SyobocalProgramMatch
 * @return number 0〜1
 */
export function programConfidence(program: SyobocalProgramMatch): number {
    // キー局の代用は同時ネットを前提にした推定なので、遅れ放送・番組差し替えのぶん最も低くする
    // (代用時は開始時刻がほぼ一致した放送しか拾わないため exactStart は必ず true になる)
    if (program.viaKeyStation === true) return 0.9;

    return program.exactStart === true ? 0.98 : 0.92;
}
@injectable()
export default class SeriesResolver implements ISeriesResolver {
    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('IAppSettingDB') private settings: IAppSettingDB,
        @inject('ISeriesDB') private db: ISeriesDB,
        @inject('INotificationDispatcher') private notification: INotificationDispatcher,
        @inject('IWorkDictionary') private workDictionary: IWorkDictionary,
        @inject('ILlmTitleExtractor') private llmTitleExtractor: ILlmTitleExtractor,
        @inject('ISyobocalProgramLookup') private programLookup: ISyobocalProgramLookup,
    ) {}
    async resolve(recording: SeriesRecordingInput, trace?: SeriesResolveTrace): Promise<RecordedSeriesLink | null> {
        if (!isFeatureEnabled(this.config.getConfig(), 'seriesLibrary')) {
            this.trace(trace, {
                step: 'featureFlag',
                label: '機能フラグ',
                input: 'featureFlags.seriesLibrary',
                output: '無効のため判定しない',
                matched: false,
            });
            return null;
        }
        const existing = await this.db.findLink(recording.recordedId);
        if (existing?.manualLock) {
            this.trace(trace, {
                step: 'manualLock',
                label: '手動確定の確認',
                input: `recordedId=${recording.recordedId}`,
                output: `手動確定済み (seriesId=${existing.seriesId}) のため判定しない`,
                matched: true,
                detail: JSON.stringify(existing),
            });
            return existing;
        }
        const now0 = Date.now();

        // 欠番補完予約提案 (§4.7) 経由の予約であれば、ヒントを最優先で使用し、
        // 通常のスコアリング・しきい値判定をバイパスして直接リンクする
        if (typeof recording.reserveId === 'number') {
            const hint = await this.db.findReservationHintByReserveId(recording.reserveId);
            if (hint) {
                await this.db.deleteReservationHint(hint.id);
                const series = await this.db.getSeries(hint.seriesId);
                const episode = await this.db.findEpisodeById(hint.episodeId);
                if (series && episode) {
                    this.trace(trace, {
                        step: 'reservationHint',
                        label: '欠番補完予約のヒント',
                        input: `reserveId=${recording.reserveId}`,
                        output: `${series.title} (episodeId=${episode.id}) で確定`,
                        matched: true,
                        detail: JSON.stringify(hint),
                    });
                    await this.db.deletePendingMatchByRecordedId(recording.recordedId);
                    return await this.db.saveLink({
                        recordedId: recording.recordedId,
                        seriesId: series.id,
                        channelId: recording.channelId,
                        episodeId: episode.id,
                        airType: hint.airType,
                        matchMethod: 'reservation-hint',
                        confidence: 1,
                        manualLock: false,
                        createdAt: now0,
                        updatedAt: now0,
                    });
                }
            }
        }

        const parsed = parseSeriesInfo(recording.title);
        this.trace(trace, {
            step: 'parse',
            label: 'タイトル正規化',
            input: recording.title,
            output:
                parsed.normalizedTitle === ''
                    ? '正規化キーを作れず判定終了'
                    : `正規化キー: ${parsed.normalizedTitle} / 話数: ${parsed.episodeNumber ?? '不明'}`,
            matched: parsed.normalizedTitle !== '',
            detail: JSON.stringify(parsed),
        });
        if (!parsed.normalizedTitle) return null;
        const now = Date.now();

        // 1. しょぼいカレンダーの放送予定 (放送局 + 放送開始時刻) を最優先で引く。
        // 局と時刻は「実際にその時間に何が放送されていたか」という事実なので、
        // タイトル文字列の照合 (含有・前方一致を許すため誤爆しうる) より確度が高い
        const program = await this.lookupProgram(recording, trace);
        const programLink = await this.resolveByProgram(recording, parsed, program, now, trace);
        if (programLink !== null) return programLink;

        // 2. エイリアス辞書 (手動修正から学習した「正規化タイトル→シリーズ」の対応) を参照する
        const alias = await this.db.findAlias(parsed.normalizedTitle);
        const aliasSeries = alias === null ? null : await this.db.getSeries(alias.seriesId);
        this.trace(trace, {
            step: 'alias',
            label: 'エイリアス辞書',
            input: parsed.normalizedTitle,
            output:
                aliasSeries === null
                    ? alias === null
                        ? '該当なし'
                        : `該当あり (seriesId=${alias.seriesId}) だがシリーズが存在しない`
                    : `${aliasSeries.title} (seriesId=${aliasSeries.id}) で確定`,
            matched: aliasSeries !== null,
            detail: alias === null ? undefined : JSON.stringify(alias),
        });
        if (aliasSeries !== null) {
            await this.db.deletePendingMatchByRecordedId(recording.recordedId);
            return await this.linkTo(recording, parsed, aliasSeries, 1, 'alias', now);
        }

        // 3. 作品辞書 (しょぼいカレンダー + Annict) で作品を確定させる。
        // 放送局ごとの表記ゆれ ("第壱話" / "break1" / "TVアニメ『X』" / "水曜アニメ・" 等) があっても
        // 同一作品へ寄せられるため、類似度スコアリングより先に試す
        const dictionaryLink = await this.resolveByWorkDictionary(recording, parsed, program, now, trace);
        if (dictionaryLink !== null) return dictionaryLink;

        // 4. 作品辞書に載らないジャンル (ドラマ・バラエティ・情報番組など) を LLM の抽出結果で束ねる。
        // 検証先の辞書が無いため、抽出した番組名が既存シリーズの正規化タイトルと完全一致した場合に限る
        const llmLink = await this.resolveByLlmGrouping(recording, parsed, now, trace);
        if (llmLink !== null) return llmLink;

        // 5. 既存シリーズとの類似度スコアリング
        const candidates = await this.db.findCandidates(parsed.normalizedTitle);
        const settings = await this.settings.getAll();
        const threshold = this.threshold((settings.series as any)?.matchThreshold);
        let winner: Series | null = null;
        let confidence = 0;
        for (const candidate of candidates) {
            const score = scoreCandidate(parsed.normalizedTitle, candidate, recording.channelId);
            if (score > confidence) {
                winner = candidate;
                confidence = score;
            }
        }

        this.trace(trace, {
            step: 'titleScoring',
            label: '既存シリーズとの類似度',
            input: `${parsed.normalizedTitle} (しきい値 ${threshold})`,
            output:
                candidates.length === 0
                    ? '候補なし → 新規シリーズを作成'
                    : winner === null || confidence < threshold
                      ? `最高スコア ${confidence.toFixed(3)} がしきい値未満 → 未確定キューへ`
                      : `${winner.title} (seriesId=${winner.id}, スコア ${confidence.toFixed(3)}) で確定`,
            matched: candidates.length === 0 || (winner !== null && confidence >= threshold),
            detail: JSON.stringify(
                candidates.map(candidate => ({
                    seriesId: candidate.id,
                    title: candidate.title,
                    score: scoreCandidate(parsed.normalizedTitle, candidate, recording.channelId),
                })),
            ),
        });

        if (candidates.length === 0) {
            // 類似候補が一件も無い = 誤リンクの恐れが無い明確な新規シリーズなので自動作成する
            winner = await this.db.createSeries({
                // 生の録画タイトルではなく話数などを除いた表示用タイトルをシリーズ名にする ("作品名 #16" のような名前を防ぐ)
                title: displaySeriesTitle(recording.title),
                normalizedTitle: parsed.normalizedTitle,
                preferredChannelId: recording.channelId,
                createdAt: now,
                updatedAt: now,
            });
            confidence = 1;
        } else if (!winner || confidence < threshold) {
            // 候補はあるがしきい値未満 = 誤リンクの恐れがあるため自動確定させず未確定キューへ積む (§4.5)
            const ranked = candidates
                .map(candidate => ({
                    seriesId: candidate.id,
                    seriesTitle: candidate.title,
                    score: scoreCandidate(parsed.normalizedTitle, candidate, recording.channelId),
                }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 3);
            await this.db.upsertPendingMatch({
                recordedId: recording.recordedId,
                normalizedTitle: parsed.normalizedTitle,
                channelId: recording.channelId,
                candidates: ranked,
                createdAt: now,
            });
            return null;
        }

        await this.db.deletePendingMatchByRecordedId(recording.recordedId);
        return await this.linkTo(recording, parsed, winner, confidence, 'title', now);
    }

    /**
     * 作品辞書 (しょぼいカレンダー + Annict) で作品を特定し、その作品のシリーズへリンクする。
     * 同じ作品のシリーズが既にあればそれへ、無ければ辞書の正式タイトルで新規作成する。
     * 辞書が未取得・該当なしの場合は null を返し、呼び出し側は従来の類似度判定へ進む
     * @param recording: SeriesRecordingInput
     * @param parsed: parseSeriesInfo() の結果
     * @param now: number
     * @return Promise<RecordedSeriesLink | null>
     */
    private async resolveByWorkDictionary(
        recording: SeriesRecordingInput,
        parsed: ReturnType<typeof parseSeriesInfo>,
        program: SyobocalProgramMatch | null,
        now: number,
        trace?: SeriesResolveTrace,
    ): Promise<RecordedSeriesLink | null> {
        let match: WorkMatch | null = null;
        // 再放送は放送日時から期を決められない (第 1 期の再放送が第 2 期の放送期間に入りうる) ため、
        // 放送日時を渡すのは初回放送・不明のときだけにする
        const airedAt = parsed.airType === 'rerun' ? undefined : recording.startAt;
        try {
            match = await this.workDictionary.lookup(recording.title, airedAt);
        } catch (err) {
            // 辞書の不調でシリーズ化そのものを止めないよう、失敗時は従来の類似度判定へ委ねる
            this.trace(trace, {
                step: 'workDictionary',
                label: '作品辞書 (しょぼいカレンダー / Annict / Wikidata)',
                input: recording.title,
                output: `照会に失敗: ${err instanceof Error ? err.message : String(err)}`,
                matched: false,
            });
            return null;
        }
        this.trace(trace, {
            step: 'workDictionary',
            label: '作品辞書 (しょぼいカレンダー / Annict / Wikidata)',
            input: recording.title,
            output:
                match === null
                    ? '該当なし'
                    : `${match.title} (${match.source}, ${match.matchType}, 確度 ${match.confidence})`,
            matched: match !== null,
            detail: match === null ? undefined : JSON.stringify(match),
        });
        let viaLlm = false;
        if (match === null) {
            // ローカル LLM フォールバック (seriesLlm 設定時のみ): 正規表現ベースの照合キーで辞書に
            // 当たらなかった場合のみ、LLM に作品名を抽出させて辞書を引き直す。
            // 抽出結果は必ず辞書で検証されるため、LLM の誤生成単体で誤リンクには至らない
            match = await this.lookupViaLlm(recording.title, airedAt);
            viaLlm = match !== null;
            this.trace(trace, {
                step: 'llmDictionary',
                label: 'LLM で作品名を抽出して辞書を引き直し',
                input: this.isLlmEnabled() === false ? 'LLM 未設定のためスキップ' : recording.title,
                output: match === null ? '該当なし' : `${match.title} (${match.source}, 確度 ${match.confidence})`,
                matched: match !== null,
                detail: match === null ? undefined : JSON.stringify(match),
            });
        }
        if (match === null) return null;

        // LLM を経由して確定した対応はエイリアス辞書へ学習させる。
        // 次回以降は resolve() でこの辞書に当たるため、同じ表記の録画で LLM を引き直さずに済む
        const series = await this.resolveSeriesFor(match, recording.channelId, now);
        if (viaLlm === true) await this.learnAlias(parsed.normalizedTitle, series, match, now);

        await this.db.deletePendingMatchByRecordedId(recording.recordedId);
        return await this.linkToWork(recording, parsed, match, series, program, matchMethodOf(match), now);
    }

    /**
     * しょぼいカレンダーの放送予定 (放送局 + 放送開始時刻) から作品を確定し、そのシリーズへリンクする。
     *
     * 「その時間にその局で何が放送されていたか」は事実なので、タイトル文字列の照合
     * (含有・前方一致を許すため誤爆しうる) より確度が高い。このため resolve() の先頭で試す。
     *
     * しょぼいカレンダー未登録の地方局は系列キー局の放送予定で代用した結果も使う。
     * 同時ネットなら同じ時刻に同じ作品が並ぶため地方局の録画でも作品を特定できるが、
     * 遅れ放送だと別番組を指しうるぶん確度は下げる (代用時は開始時刻がほぼ一致した場合しか拾わない)
     * @param recording: SeriesRecordingInput
     * @param parsed: parseSeriesInfo() の結果
     * @param program: SyobocalProgramMatch | null 放送予定の照会結果
     * @param now: number
     * @return Promise<RecordedSeriesLink | null> 確定できなかった場合は null
     */
    private async resolveByProgram(
        recording: SeriesRecordingInput,
        parsed: ReturnType<typeof parseSeriesInfo>,
        program: SyobocalProgramMatch | null,
        now: number,
        trace?: SeriesResolveTrace,
    ): Promise<RecordedSeriesLink | null> {
        if (program === null) return null;

        const match = await this.workDictionary.findByIds({ syobocalTid: program.tid }).catch(() => null);
        // 時刻ずれ・キー局の代用で別番組を拾った場合を弾く。
        // 録画タイトルと共通部分が皆無な作品名は取り違えとみなし、後続の判定へ委ねる
        const plausible = match === null ? false : isPlausibleProgramTitle(recording.title, match.title);
        this.trace(trace, {
            step: 'programMatch',
            label: '放送予定の TID を作品辞書で引く',
            input: `syobocalTid=${program.tid}`,
            output:
                match === null
                    ? '作品辞書に該当なし'
                    : plausible === false
                      ? `${match.title} は録画タイトルと共通部分が無いためスキップ`
                      : `${match.title} で確定 (確度 ${programConfidence(program)})`,
            matched: match !== null && plausible === true,
            detail: match === null ? undefined : JSON.stringify(match),
        });
        if (match === null || plausible === false) return null;

        const confidence = programConfidence(program);
        const series = await this.resolveSeriesFor(match, recording.channelId, now);

        await this.db.deletePendingMatchByRecordedId(recording.recordedId);
        return await this.linkToWork(
            recording,
            parsed,
            { ...match, confidence },
            series,
            program,
            matchMethodOf(match),
            now,
        );
    }

    /**
     * 作品辞書の照合結果に対応するシリーズを返す (無ければ辞書の正式タイトルで新規作成する)。
     * 既存シリーズに未設定の項目があれば辞書側で判明した値を補完する
     * @param match: WorkMatch
     * @param channelId: number
     * @param now: number
     * @return Promise<Series>
     */
    private async resolveSeriesFor(match: WorkMatch, channelId: number, now: number): Promise<Series> {
        // しょぼいカレンダー TID を優先キーにし、無い作品 (Annict 単独) は annictId で引く
        let series =
            match.syobocalTid !== null
                ? await this.db.findBySyobocalTid(match.syobocalTid)
                : match.annictId !== null
                  ? await this.db.findByAnnictId(String(match.annictId))
                  : match.wikidataQid !== null
                    ? await this.db.findByWikidataQid(match.wikidataQid)
                    : null;
        if (series === null) {
            series = await this.db.createSeries({
                // 録画タイトル由来のゆらいだ名前ではなく辞書の正式タイトルをシリーズ名にする
                title: match.title,
                titleSource: 'dictionary',
                normalizedTitle: normalizeSeriesTitle(match.title),
                preferredChannelId: channelId,
                syobocalTid: match.syobocalTid,
                annictId: match.annictId === null ? null : String(match.annictId),
                wikidataQid: match.wikidataQid,
                tmdbId: match.tmdbId,
                titleKana: match.titleKana,
                seasonYear: match.seasonYear,
                seasonName: match.seasonName,
                totalEpisodes: match.totalEpisodes,
                createdAt: now,
                updatedAt: now,
            });
        } else {
            // 既存シリーズに未設定の項目があれば、辞書側で判明した値を補完する
            // (外部 ID は Annict 視聴記録の同期に、クール・読み仮名・総話数は一覧の並べ替えと
            //  絞り込みに使う)
            const patch: {
                syobocalTid?: number | null;
                annictId?: string | null;
                wikidataQid?: string | null;
                tmdbId?: number | null;
                titleKana?: string | null;
                seasonYear?: number | null;
                seasonName?: string | null;
                totalEpisodes?: number | null;
            } = {};
            if (series.syobocalTid === null && match.syobocalTid !== null) patch.syobocalTid = match.syobocalTid;
            if (series.annictId === null && match.annictId !== null) patch.annictId = String(match.annictId);
            if (series.wikidataQid === null && match.wikidataQid !== null) patch.wikidataQid = match.wikidataQid;
            if (series.tmdbId === null && match.tmdbId !== null) patch.tmdbId = match.tmdbId;
            if (series.titleKana === null && match.titleKana !== null) patch.titleKana = match.titleKana;
            if (series.seasonYear === null && match.seasonYear !== null) patch.seasonYear = match.seasonYear;
            if (series.seasonName === null && match.seasonName !== null) patch.seasonName = match.seasonName;
            if (series.totalEpisodes === null && match.totalEpisodes !== null) {
                patch.totalEpisodes = match.totalEpisodes;
            }
            if (Object.keys(patch).length > 0) {
                await this.db.updateExternalMetadata(series.id, patch);
            }
        }

        return series;
    }

    /**
     * 確定した作品のシリーズへ録画をリンクする (話数・サブタイトル・放送回コメントの解決を含む)
     * @param recording: SeriesRecordingInput
     * @param parsed: parseSeriesInfo() の結果
     * @param match: WorkMatch 作品辞書の照合結果
     * @param series: Series リンク先シリーズ
     * @param program: SyobocalProgramMatch | null 放送予定の照会結果
     * @param matchMethod: RecordedSeriesLink['matchMethod']
     * @param now: number
     * @return Promise<RecordedSeriesLink>
     */
    private async linkToWork(
        recording: SeriesRecordingInput,
        parsed: ReturnType<typeof parseSeriesInfo>,
        match: WorkMatch,
        series: Series,
        program: SyobocalProgramMatch | null,
        matchMethod: RecordedSeriesLink['matchMethod'],
        now: number,
    ): Promise<RecordedSeriesLink> {
        // 放送予定が確定した作品と同じ作品を指している場合のみ、その内容を採用する。
        // TID の一致を条件にすることで、時刻ずれで隣の番組を拾った場合や、キー局で代用した局が
        // 遅れ放送だった場合に別作品の話数を持ち込むことを防ぐ
        const confirmed = program !== null && program.tid === match.syobocalTid ? program : null;

        const resolved = { ...parsed };
        // 1. 放送予定の話数。局と時刻だけで決まるため録画タイトルの表記より確実で、
        //    タイトルに話数表記がある場合もこちらを優先する
        if (confirmed !== null && confirmed.count !== null) resolved.episodeNumber = confirmed.count;
        // 2. 話数がまだ決まらない録画は、サブタイトル一覧との照合で逆引きする。
        //    総集編・一挙放送と判定した録画は通し話数を持たないため対象から外す
        if (resolved.episodeNumber === null && match.syobocalTid !== null && parsed.isSpecial === false) {
            const episodeNumber = await this.workDictionary
                .lookupEpisodeNumber(match.syobocalTid, recording.title)
                .catch(() => null);
            if (episodeNumber !== null) resolved.episodeNumber = episodeNumber;
        }
        // 3. それでも決まらない場合は遅れ放送とみなし、系列キー局の「同じ作品の放送」を遡って対応付ける。
        //    しょぼいカレンダー未登録の県域局はキー局の数日後に流すため同時刻の照合では拾えないが、
        //    作品が確定していればキー局の放送予定をその作品に絞って追える
        const delayed =
            resolved.episodeNumber === null && match.syobocalTid !== null && parsed.isSpecial === false
                ? await this.lookupDelayedProgram(recording, match.syobocalTid)
                : null;
        if (delayed !== null && delayed.count !== null) {
            resolved.episodeNumber = delayed.count;
            // キー局より後に流れている = 遅れ放送と分かるので、放送種別も確定させる
            if (resolved.airType === 'unknown') resolved.airType = 'delayed';
        }
        // 放送予定から取れたサブタイトルはその回の実際の放送内容なので、話数からの逆引きより優先する
        const episodeTitle = confirmed?.subTitle ?? delayed?.subTitle ?? null;
        const episodeComment = confirmed?.comment ?? null;

        return await this.linkTo(
            recording,
            resolved,
            series,
            match.confidence,
            matchMethod,
            now,
            episodeTitle,
            episodeComment,
        );
    }

    /**
     * しょぼいカレンダーの放送予定を放送局 + 放送開始時刻で引く。
     * 連携が無効・局が未対応・該当放送なしの場合は null を返す (シリーズ化自体は従来経路で成立する)
     * @param recording: SeriesRecordingInput
     * @return Promise<SyobocalProgramMatch | null>
     */
    private async lookupProgram(
        recording: SeriesRecordingInput,
        trace?: SeriesResolveTrace,
    ): Promise<SyobocalProgramMatch | null> {
        const input = `channelId=${recording.channelId}, startAt=${new Date(recording.startAt).toLocaleString()}`;
        try {
            const result = await this.programLookup.lookup(recording.channelId, recording.startAt);
            const program = result.match;
            this.trace(trace, {
                step: 'programLookup',
                label: 'しょぼいカレンダーの放送予定照会 (局 + 開始時刻)',
                input: input,
                // 引けなかった場合も「どの ChID を引いて何件返ったか」を出す (切り分け用)
                output:
                    program === null
                        ? `該当する放送予定なし — ${result.detail}`
                        : `TID=${program.tid} 第${program.count ?? '?'}話 ${program.subTitle ?? ''}` +
                          ` (${program.exactStart === true ? '開始時刻一致' : '時間帯包含'}` +
                          `${program.viaKeyStation === true ? ', キー局代用' : ''}) — ${result.detail}`,
                matched: program !== null,
                detail: program === null ? undefined : JSON.stringify(program),
            });

            return program;
        } catch (err) {
            this.trace(trace, {
                step: 'programLookup',
                label: 'しょぼいカレンダーの放送予定照会 (局 + 開始時刻)',
                input: input,
                output: `照会に失敗: ${err instanceof Error ? err.message : String(err)}`,
                matched: false,
            });

            return null;
        }
    }

    /**
     * 系列キー局の放送予定から、この録画に対応する遅れ放送を引く。
     * 連携が無効・キー局が分からない・該当放送が無い場合は null を返す (話数が付かないだけ)
     * @param recording: SeriesRecordingInput
     * @param syobocalTid: number 確定済みの作品 ID
     * @return Promise<SyobocalProgramMatch | null>
     */
    private async lookupDelayedProgram(
        recording: SeriesRecordingInput,
        syobocalTid: number,
    ): Promise<SyobocalProgramMatch | null> {
        try {
            return await this.programLookup.lookupDelayed(recording.channelId, recording.startAt, syobocalTid);
        } catch {
            return null;
        }
    }

    /**
     * トレース収集器が渡されている場合のみ 1 ステップ分を記録する
     * @param trace: SeriesResolveTrace | undefined
     * @param step: SeriesResolveTrace[number]
     */
    private trace(trace: SeriesResolveTrace | undefined, step: SeriesResolveTrace[number]): void {
        if (typeof trace === 'undefined') return;
        trace.push(step);
    }

    /**
     * 作品辞書 (アニメのみ) に載らないジャンルの番組を、LLM が抽出した番組名で既存シリーズへ束ねる。
     * 検証に使える外部辞書が無いぶん、抽出結果を正規化したキーが既存シリーズの正規化タイトルと
     * 完全一致した場合だけ確定させる (前方一致・類似は 4. のスコアリングへ委ねる)。
     * 確定した対応はエイリアス辞書へ学習させ、次回以降は LLM を引かずに済むようにする
     * @param recording: SeriesRecordingInput
     * @param parsed: parseSeriesInfo() の結果
     * @param now: number
     * @return Promise<RecordedSeriesLink | null>
     */
    private async resolveByLlmGrouping(
        recording: SeriesRecordingInput,
        parsed: ReturnType<typeof parseSeriesInfo>,
        now: number,
        trace?: SeriesResolveTrace,
    ): Promise<RecordedSeriesLink | null> {
        if (this.isLlmEnabled() === false) {
            this.trace(trace, {
                step: 'llmGrouping',
                label: 'LLM 抽出名で既存シリーズへ束ねる',
                input: recording.title,
                output: 'LLM 未設定のためスキップ',
                matched: false,
            });

            return null;
        }
        try {
            // 直前の作品辞書フォールバックと同じタイトルなので、抽出結果はキャッシュから返る
            const extracted = await this.llmTitleExtractor.extractWorkTitle(recording.title);
            const key = extracted === null ? '' : normalizeSeriesTitle(extracted);
            const derived = extracted !== null && isDerivedFromTitle(recording.title, extracted);
            const candidates = derived === true && key !== '' ? await this.db.findCandidates(key) : [];
            const series = candidates.find(candidate => candidate.normalizedTitle === key) ?? null;
            this.trace(trace, {
                step: 'llmGrouping',
                label: 'LLM 抽出名で既存シリーズへ束ねる',
                input: recording.title,
                output:
                    extracted === null
                        ? '抽出できず'
                        : derived === false
                          ? `抽出結果「${extracted}」は録画タイトル由来でないため破棄`
                          : key === '' || key === parsed.normalizedTitle
                            ? `抽出結果「${extracted}」は録画タイトルと同じ正規化キーのため情報なし`
                            : series === null
                              ? `抽出結果「${extracted}」に完全一致する既存シリーズなし`
                              : `${series.title} (seriesId=${series.id}) で確定`,
                matched: series !== null,
                detail: extracted === null ? undefined : JSON.stringify({ extracted: extracted, key: key }),
            });
            if (extracted === null || derived === false) return null;
            // 正規化キーが録画タイトルのものと同じなら、LLM は新しい情報を出せていない
            if (key === '' || key === parsed.normalizedTitle) return null;
            if (series === null) return null;

            await this.learnAliasFor(parsed.normalizedTitle, series.id, now);
            await this.db.deletePendingMatchByRecordedId(recording.recordedId);

            // 外部辞書の裏付けが無いぶん、辞書経由 (最大 0.95) より低い確度で記録する
            return await this.linkTo(recording, parsed, series, 0.9, 'llm', now);
        } catch (err) {
            this.trace(trace, {
                step: 'llmGrouping',
                label: 'LLM 抽出名で既存シリーズへ束ねる',
                input: recording.title,
                output: `失敗: ${err instanceof Error ? err.message : String(err)}`,
                matched: false,
            });

            return null;
        }
    }

    /**
     * LLM フォールバックが使えるか (未設定・DI 未注入なら無効)
     * @return boolean
     */
    private isLlmEnabled(): boolean {
        try {
            return this.llmTitleExtractor?.isEnabled() === true;
        } catch {
            return false;
        }
    }

    /**
     * 「正規化タイトル → シリーズ」の対応をエイリアス辞書へ記録する (マッチングルールの学習)。
     * エイリアスは確度 1.0 で確定させる強い規則なので、LLM が抽出した作品名が辞書キーと
     * 完全一致した場合 (matchType: 'exact') のみ記録し、部分一致・前方一致の推測は学習しない
     * @param normalizedTitle: string 録画タイトルの正規化キー
     * @param series: Series 対応先シリーズ
     * @param match: WorkMatch 辞書の照合結果
     * @param now: number
     */
    private async learnAlias(normalizedTitle: string, series: Series, match: WorkMatch, now: number): Promise<void> {
        if (match.matchType !== 'exact') return;
        await this.learnAliasFor(normalizedTitle, series.id, now);
    }

    /**
     * エイリアス辞書へ 1 件学習する。手動修正で作られた既存の対応は上書きしない
     * @param normalizedTitle: string 録画タイトルの正規化キー
     * @param seriesId: number 対応先シリーズ ID
     * @param now: number
     */
    private async learnAliasFor(normalizedTitle: string, seriesId: number, now: number): Promise<void> {
        if (normalizedTitle === '') return;
        try {
            const current = await this.db.findAlias(normalizedTitle);
            if (current !== null) return;
            await this.db.upsertAlias(normalizedTitle, seriesId, now, 'llm');
        } catch {
            // 学習に失敗してもリンク自体は成立しているので握りつぶす
        }
    }

    /**
     * ローカル LLM に録画タイトルから作品名を抽出させ、その作品名で作品辞書を引き直す。
     * LLM 未設定・抽出失敗・辞書に該当なしの場合は null を返し、従来の類似度判定へ委ねる。
     * LLM を経由した分の不確かさを confidence に反映する (完全一致でも 1.0 にはしない)
     * @param recordedTitle: string 録画番組タイトル
     * @param airedAt: number | undefined 録画の放送開始時刻 (続編の期を選び分けるのに使う)
     * @return Promise<WorkMatch | null>
     */
    private async lookupViaLlm(recordedTitle: string, airedAt?: number): Promise<WorkMatch | null> {
        if (this.isLlmEnabled() === false) return null;
        try {
            const extracted = await this.llmTitleExtractor.extractWorkTitle(recordedTitle);
            if (extracted === null) return null;
            // 実在する別作品の名前を返す誤りを落とす (辞書で引けてしまうため辞書検証だけでは防げない)
            if (isDerivedFromTitle(recordedTitle, extracted) === false) return null;
            const match = await this.workDictionary.lookup(extracted, airedAt);
            if (match === null) return null;
            return { ...match, confidence: Math.min(match.confidence, 0.95) };
        } catch {
            return null;
        }
    }

    /**
     * 確定したシリーズへ録画をリンクする (エピソード解決 + 再放送判定を含む)
     * @param episodeTitle: string | null 放送予定から取れたサブタイトル。null の場合は
     *                      シリーズの しょぼいカレンダー TID からサブタイトル一覧を引いて補う
     */
    private async linkTo(
        recording: SeriesRecordingInput,
        parsed: ReturnType<typeof parseSeriesInfo>,
        series: Series,
        confidence: number,
        matchMethod: RecordedSeriesLink['matchMethod'],
        now: number,
        episodeTitle: string | null = null,
        episodeComment: string | null = null,
    ): Promise<RecordedSeriesLink> {
        let episode = null;
        let isNewEpisode = false;
        if (parsed.episodeNumber !== null) {
            const subTitle = episodeTitle ?? (await this.lookupEpisodeTitle(series, parsed.episodeNumber));
            episode = await this.db.findEpisode(series.id, parsed.seasonNumber, parsed.episodeNumber);
            if (!episode) {
                episode = await this.db.createEpisode({
                    seriesId: series.id,
                    seasonNumber: parsed.seasonNumber,
                    episodeNumber: parsed.episodeNumber,
                    episodeLabel: parsed.episodeLabel,
                    title: subTitle,
                    comment: episodeComment,
                    commentSource: episodeComment === null ? null : 'dictionary',
                    airedAt: recording.startAt,
                    createdAt: now,
                    updatedAt: now,
                });
                isNewEpisode = true;
            } else {
                // 辞書の同期前に作られたエピソードにも、後から引けたサブタイトル・コメントを埋める
                const fill = {
                    title: episode.title === null ? subTitle : null,
                    comment: episode.comment === null ? episodeComment : null,
                };
                if (fill.title !== null || fill.comment !== null) {
                    await this.db.fillEpisodeMetadata(episode.id, fill, now).catch(() => {});
                    episode = {
                        ...episode,
                        title: fill.title ?? episode.title,
                        comment: fill.comment ?? episode.comment,
                    };
                }
            }
        }
        let airType = parsed.airType;
        if (airType === 'unknown' && episode)
            airType =
                (await this.db.countOtherLinksByEpisode(episode.id, recording.recordedId)) > 0 ? 'rerun' : 'first';

        // シリーズ新話追加通知 (§7.3): 新規エピソード行が作られ、かつ再放送でないと判定できた場合のみ
        if (isNewEpisode && airType === 'first') {
            void this.notification.dispatch('series.newEpisode', {
                seriesId: series.id,
                seriesTitle: series.title,
                recordedId: recording.recordedId,
                episodeNumber: parsed.episodeNumber,
                episodeLabel: parsed.episodeLabel,
            });
        }
        return await this.db.saveLink({
            recordedId: recording.recordedId,
            seriesId: series.id,
            channelId: recording.channelId,
            episodeId: episode?.id ?? null,
            airType,
            matchMethod,
            confidence,
            manualLock: false,
            createdAt: now,
            updatedAt: now,
        });
    }
    /**
     * シリーズの しょぼいカレンダー TID から、その話数のサブタイトルを引く。
     * ローカルの辞書だけを使うため外部通信は伴わない
     * @param series: Series
     * @param episodeNumber: number
     * @return Promise<string | null>
     */
    private async lookupEpisodeTitle(series: Series, episodeNumber: number): Promise<string | null> {
        if (typeof series.syobocalTid !== 'number') return null;
        try {
            return await this.workDictionary.lookupEpisodeTitle(series.syobocalTid, episodeNumber);
        } catch {
            return null;
        }
    }

    private threshold(value: unknown): number {
        // 優先順位: DB (設定画面) > config.yml (seriesDefaults) > ハードコード既定値 (§6.3)
        const resolved = resolveNumber(value, this.config.getConfig().seriesDefaults?.matchThreshold, 0.8);
        return Math.min(1, Math.max(0, resolved));
    }
}
