import { inject, injectable } from 'inversify';
import RecordedSeriesLink from '../../db/entities/RecordedSeriesLink';
import Series from '../../db/entities/Series';
import { isFeatureEnabled } from '../FeatureFlags';
import IConfiguration from '../IConfiguration';
import IAppSettingDB from '../db/IAppSettingDB';
import ISeriesDB from '../db/ISeriesDB';
import ISeriesResolver, { SeriesRecordingInput } from './ISeriesResolver';
import { parseSeriesInfo } from './SeriesNormalizer';
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
@injectable()
export default class SeriesResolver implements ISeriesResolver {
    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('IAppSettingDB') private settings: IAppSettingDB,
        @inject('ISeriesDB') private db: ISeriesDB,
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

        // 2. 既存シリーズとの類似度スコアリング
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
                title: recording.title,
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
     * 確定したシリーズへ録画をリンクする (エピソード解決 + 再放送判定を含む)
     */
    private async linkTo(
        recording: SeriesRecordingInput,
        parsed: ReturnType<typeof parseSeriesInfo>,
        series: Series,
        confidence: number,
        matchMethod: RecordedSeriesLink['matchMethod'],
        now: number,
    ): Promise<RecordedSeriesLink> {
        let episode = null;
        if (parsed.episodeNumber !== null) {
            episode = await this.db.findEpisode(series.id, parsed.seasonNumber, parsed.episodeNumber);
            if (!episode)
                episode = await this.db.createEpisode({
                    seriesId: series.id,
                    seasonNumber: parsed.seasonNumber,
                    episodeNumber: parsed.episodeNumber,
                    episodeLabel: parsed.episodeLabel,
                    title: null,
                    airedAt: recording.startAt,
                    createdAt: now,
                    updatedAt: now,
                });
        }
        let airType = parsed.airType;
        if (airType === 'unknown' && episode)
            airType =
                (await this.db.countOtherLinksByEpisode(episode.id, recording.recordedId)) > 0 ? 'rerun' : 'first';
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
    private threshold(value: unknown): number {
        return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.8;
    }
}
