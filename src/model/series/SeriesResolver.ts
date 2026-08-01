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
import ISeriesResolver, { SeriesRecordingInput } from './ISeriesResolver';
import { displaySeriesTitle, isDerivedFromTitle, normalizeSeriesTitle, parseSeriesInfo } from './SeriesNormalizer';
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
    async resolve(recording: SeriesRecordingInput): Promise<RecordedSeriesLink | null> {
        if (!isFeatureEnabled(this.config.getConfig(), 'seriesLibrary')) return null;
        const existing = await this.db.findLink(recording.recordedId);
        if (existing?.manualLock) return existing;
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
        if (!parsed.normalizedTitle) return null;
        const now = Date.now();

        // 1. エイリアス辞書 (手動修正から学習した「正規化タイトル→シリーズ」の対応) を最優先で参照する
        const alias = await this.db.findAlias(parsed.normalizedTitle);
        if (alias) {
            const aliasSeries = await this.db.getSeries(alias.seriesId);
            if (aliasSeries) {
                await this.db.deletePendingMatchByRecordedId(recording.recordedId);
                return await this.linkTo(recording, parsed, aliasSeries, 1, 'alias', now);
            }
        }

        // 2. 作品辞書 (しょぼいカレンダー + Annict) で作品を確定させる。
        // 放送局ごとの表記ゆれ ("第壱話" / "break1" / "TVアニメ『X』" / "水曜アニメ・" 等) があっても
        // 同一作品へ寄せられるため、類似度スコアリングより先に試す
        const dictionaryLink = await this.resolveByWorkDictionary(recording, parsed, now);
        if (dictionaryLink !== null) return dictionaryLink;

        // 3. 作品辞書に載らないジャンル (ドラマ・バラエティ・情報番組など) を LLM の抽出結果で束ねる。
        // 検証先の辞書が無いため、抽出した番組名が既存シリーズの正規化タイトルと完全一致した場合に限る
        const llmLink = await this.resolveByLlmGrouping(recording, parsed, now);
        if (llmLink !== null) return llmLink;

        // 4. 既存シリーズとの類似度スコアリング
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
        now: number,
    ): Promise<RecordedSeriesLink | null> {
        let match: WorkMatch | null = null;
        try {
            match = await this.workDictionary.lookup(recording.title);
        } catch {
            // 辞書の不調でシリーズ化そのものを止めないよう、失敗時は従来の類似度判定へ委ねる
            return null;
        }
        let viaLlm = false;
        if (match === null) {
            // ローカル LLM フォールバック (seriesLlm 設定時のみ): 正規表現ベースの照合キーで辞書に
            // 当たらなかった場合のみ、LLM に作品名を抽出させて辞書を引き直す。
            // 抽出結果は必ず辞書で検証されるため、LLM の誤生成単体で誤リンクには至らない
            match = await this.lookupViaLlm(recording.title);
            viaLlm = match !== null;
        }

        // しょぼいカレンダーの放送予定 (放送局 + 放送開始時刻) から確定させる。
        // タイトルの表記に一切依存しないため、局が作品名を独自表記で送出していて
        // 辞書キーに当たらない録画でも作品を特定できる
        let program: SyobocalProgramMatch | null = null;
        if (match === null) {
            program = await this.lookupProgram(recording);
            if (program !== null) {
                const byProgram = await this.workDictionary.findByIds({ syobocalTid: program.tid }).catch(() => null);
                // 局と時刻の一致は強い根拠だが、放送予定側の時刻ずれで隣の番組を拾う余地があるため
                // タイトル照合で確定した場合 (最大 1.0) より低い確度で記録する
                if (byProgram !== null) match = { ...byProgram, confidence: Math.min(byProgram.confidence, 0.95) };
            }
        }
        if (match === null) return null;

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
                normalizedTitle: normalizeSeriesTitle(match.title),
                preferredChannelId: recording.channelId,
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

        // 話数表記が無い録画の話数を復元する。
        // 総集編・一挙放送と判定した録画は通し話数を持たないため、逆引きの対象から外す
        const resolved = { ...parsed };
        if (resolved.episodeNumber === null && match.syobocalTid !== null && parsed.isSpecial === false) {
            // 1. 放送予定の話数 (放送局 + 放送開始時刻で引くためタイトル表記に依存しない。最も確度が高い)
            if (program === null) program = await this.lookupProgram(recording);
            if (program !== null && program.tid === match.syobocalTid && program.count !== null) {
                resolved.episodeNumber = program.count;
            }
            // 2. サブタイトル一覧との照合による逆引き
            if (resolved.episodeNumber === null) {
                const episodeNumber = await this.workDictionary
                    .lookupEpisodeNumber(match.syobocalTid, recording.title)
                    .catch(() => null);
                if (episodeNumber !== null) resolved.episodeNumber = episodeNumber;
            }
        }
        // 放送予定から取れたサブタイトルはその回の実際の放送内容なので、話数からの逆引きより優先する
        const episodeTitle = program !== null && program.tid === match.syobocalTid ? program.subTitle : null;

        // LLM を経由して確定した対応はエイリアス辞書へ学習させる。
        // 次回以降は resolve() の先頭でこの辞書に当たるため、同じ表記の録画で LLM を引き直さずに済む
        if (viaLlm === true) await this.learnAlias(parsed.normalizedTitle, series, match, now);

        await this.db.deletePendingMatchByRecordedId(recording.recordedId);
        return await this.linkTo(
            recording,
            resolved,
            series,
            match.confidence,
            matchMethodOf(match),
            now,
            episodeTitle,
        );
    }

    /**
     * しょぼいカレンダーの放送予定を放送局 + 放送開始時刻で引く。
     * 連携が無効・局が未対応・該当放送なしの場合は null を返す (シリーズ化自体は従来経路で成立する)
     * @param recording: SeriesRecordingInput
     * @return Promise<SyobocalProgramMatch | null>
     */
    private async lookupProgram(recording: SeriesRecordingInput): Promise<SyobocalProgramMatch | null> {
        try {
            return await this.programLookup.lookup(recording.channelId, recording.startAt);
        } catch {
            return null;
        }
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
    ): Promise<RecordedSeriesLink | null> {
        if (this.isLlmEnabled() === false) return null;
        try {
            // 直前の作品辞書フォールバックと同じタイトルなので、抽出結果はキャッシュから返る
            const extracted = await this.llmTitleExtractor.extractWorkTitle(recording.title);
            if (extracted === null) return null;
            // 実在する別番組の名前を返す誤りを落とす (既存シリーズに当たってしまうため検証だけでは防げない)
            if (isDerivedFromTitle(recording.title, extracted) === false) return null;

            const key = normalizeSeriesTitle(extracted);
            // 正規化キーが録画タイトルのものと同じなら、LLM は新しい情報を出せていない
            if (key === '' || key === parsed.normalizedTitle) return null;

            const candidates = await this.db.findCandidates(key);
            const series = candidates.find(candidate => candidate.normalizedTitle === key) ?? null;
            if (series === null) return null;

            await this.learnAliasFor(parsed.normalizedTitle, series.id, now);
            await this.db.deletePendingMatchByRecordedId(recording.recordedId);

            // 外部辞書の裏付けが無いぶん、辞書経由 (最大 0.95) より低い確度で記録する
            return await this.linkTo(recording, parsed, series, 0.9, 'llm', now);
        } catch {
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
     * @return Promise<WorkMatch | null>
     */
    private async lookupViaLlm(recordedTitle: string): Promise<WorkMatch | null> {
        if (this.isLlmEnabled() === false) return null;
        try {
            const extracted = await this.llmTitleExtractor.extractWorkTitle(recordedTitle);
            if (extracted === null) return null;
            // 実在する別作品の名前を返す誤りを落とす (辞書で引けてしまうため辞書検証だけでは防げない)
            if (isDerivedFromTitle(recordedTitle, extracted) === false) return null;
            const match = await this.workDictionary.lookup(extracted);
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
                    airedAt: recording.startAt,
                    createdAt: now,
                    updatedAt: now,
                });
                isNewEpisode = true;
            } else if (episode.title === null && subTitle !== null) {
                // 辞書の同期前に作られたエピソードにも、後から引けたサブタイトルを埋める
                await this.db.fillEpisodeTitle(episode.id, subTitle, now).catch(() => {});
                episode = { ...episode, title: subTitle };
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
