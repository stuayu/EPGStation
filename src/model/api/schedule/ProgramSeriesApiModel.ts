import { inject, injectable } from 'inversify';
import Series from '../../../db/entities/Series';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import IAppSettingDB from '../../db/IAppSettingDB';
import IProgramDB from '../../db/IProgramDB';
import IProgramSeriesDB from '../../db/IProgramSeriesDB';
import ISeriesDB from '../../db/ISeriesDB';
import { parseSeriesInfo } from '../../series/SeriesNormalizer';
import { scoreCandidate } from '../../series/SeriesResolver';
import IProgramSeriesApiModel, {
    ProgramSeriesMetrics,
    ProgramSeriesPrecomputeResult,
    ProgramSeriesResult,
} from './IProgramSeriesApiModel';

/**
 * 番組表 ⇄ シリーズライブラリの対応を扱う API モデル (§4.10)。
 * 対応の確定 (DB 書き込み) は EPG 更新時の precompute() バッチでのみ行い、
 * get() は保存済みの対応を参照するだけの副作用フリーな読み取り専用メソッドにする。
 * 判定基準 (しきい値) は録画側の SeriesResolver (scoreCandidate) と統一する
 */
@injectable()
export default class ProgramSeriesApiModel implements IProgramSeriesApiModel {
    private static readonly DEFAULT_MATCH_THRESHOLD = 0.8;
    private static readonly METRICS_SETTINGS_KEY = 'programSeriesMetrics';

    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('IProgramDB') private programs: IProgramDB,
        @inject('IProgramSeriesDB') private links: IProgramSeriesDB,
        @inject('ISeriesDB') private seriesDB: ISeriesDB,
        @inject('IAppSettingDB') private settings: IAppSettingDB,
    ) {}

    /**
     * 保存済みの番組 ⇄ シリーズ対応を取得する。DB への書き込みは行わない
     */
    public async get(programId: number): Promise<ProgramSeriesResult | null> {
        this.enabled();
        const current = await this.links.get(programId);
        return current ? this.result(current) : null;
    }

    /**
     * EPG 更新で変更のあった programIds について、事前にシリーズ対応を計算し保存する。
     * SeriesResolver と同じしきい値判定 (既定 0.8、settings.series.matchThreshold で変更可) を用い、
     * しきい値未満の場合は誤リンクを避けるため確定させない (未マッチとしてメトリクスにのみ反映する)
     */
    public async precompute(programIds: number[]): Promise<ProgramSeriesPrecomputeResult> {
        this.enabled();
        const now = Date.now();
        const threshold = await this.threshold();
        const confidences: number[] = [];
        let processed = 0;
        let matched = 0;
        let pending = 0;
        let skipped = 0;

        for (const programId of programIds) {
            processed++;
            const existing = await this.links.get(programId);
            if (existing) {
                matched++;
                confidences.push(Number(existing.confidence));
                continue;
            }
            const program = await this.programs.findId(programId);
            if (!program) {
                skipped++;
                continue;
            }
            const parsed = parseSeriesInfo(program.name);
            if (!parsed.normalizedTitle) {
                skipped++;
                continue;
            }
            const candidates = await this.seriesDB.findCandidates(parsed.normalizedTitle);
            let winner: Series | null = null;
            let confidence = 0;
            for (const candidate of candidates) {
                const score = scoreCandidate(parsed.normalizedTitle, candidate, program.channelId);
                if (score > confidence) {
                    winner = candidate;
                    confidence = score;
                }
            }
            if (candidates.length === 0) {
                // 類似候補が無い = 誤リンクの恐れが無い明確な新規シリーズなので自動作成する
                winner = await this.seriesDB.createSeries({
                    title: program.name,
                    normalizedTitle: parsed.normalizedTitle,
                    preferredChannelId: program.channelId,
                    createdAt: now,
                    updatedAt: now,
                });
                confidence = 1;
            } else if (!winner || confidence < threshold) {
                // しきい値未満 = 誤リンクの恐れがあるため確定させない (§4.10)
                pending++;
                confidences.push(confidence);
                continue;
            }

            let episode = null;
            if (parsed.episodeNumber !== null) {
                episode = await this.seriesDB.findEpisode(winner.id, parsed.seasonNumber, parsed.episodeNumber);
                if (!episode)
                    episode = await this.seriesDB.createEpisode({
                        seriesId: winner.id,
                        seasonNumber: parsed.seasonNumber,
                        episodeNumber: parsed.episodeNumber,
                        episodeLabel: parsed.episodeLabel,
                        title: null,
                        airedAt: program.startAt,
                        createdAt: now,
                        updatedAt: now,
                    });
            }
            await this.links.save({
                programId,
                seriesId: winner.id,
                episodeId: episode?.id ?? null,
                confidence,
                source: 'epg',
                manualLock: false,
                updatedAt: now,
            });
            matched++;
            confidences.push(confidence);
        }

        await this.saveMetrics(processed, matched, confidences, now);
        return { processed, matched, pending, skipped };
    }

    /**
     * 直近の precompute バッチの精度メトリクスを取得する
     */
    public async metrics(): Promise<ProgramSeriesMetrics> {
        const all = await this.settings.getAll();
        const stored = all[ProgramSeriesApiModel.METRICS_SETTINGS_KEY] as ProgramSeriesMetrics | undefined;
        return (
            stored ?? {
                unmatchedRate: 0,
                confidenceHistogram: [0, 0, 0, 0, 0],
                totalPrograms: 0,
                matchedPrograms: 0,
                updatedAt: null,
            }
        );
    }

    private async saveMetrics(total: number, matched: number, confidences: number[], now: number): Promise<void> {
        const histogram = [0, 0, 0, 0, 0];
        for (const c of confidences) {
            const bucket = Math.min(4, Math.floor(Math.max(0, Math.min(1, c)) * 5));
            histogram[bucket]++;
        }
        const metrics: ProgramSeriesMetrics = {
            unmatchedRate: total === 0 ? 0 : 1 - matched / total,
            confidenceHistogram: histogram,
            totalPrograms: total,
            matchedPrograms: matched,
            updatedAt: now,
        };
        await this.settings.upsert({ [ProgramSeriesApiModel.METRICS_SETTINGS_KEY]: metrics });
    }

    private async threshold(): Promise<number> {
        const all = await this.settings.getAll();
        const value = (all.series as any)?.matchThreshold;
        return typeof value === 'number' && Number.isFinite(value)
            ? Math.min(1, Math.max(0, value))
            : ProgramSeriesApiModel.DEFAULT_MATCH_THRESHOLD;
    }

    private result(x: {
        programId: number;
        seriesId: number;
        episodeId: number | null;
        confidence: number;
        source: string;
    }): ProgramSeriesResult {
        return {
            programId: Number(x.programId),
            seriesId: Number(x.seriesId),
            episodeId: x.episodeId === null ? null : Number(x.episodeId),
            confidence: Number(x.confidence),
            source: x.source,
        };
    }

    private enabled(): void {
        const config = this.config.getConfig();
        if (!isFeatureEnabled(config, 'seriesLibrary') || !isFeatureEnabled(config, 'programSeriesMapping'))
            throw new Error('ProgramSeriesMappingFeatureIsDisabled');
    }
}
