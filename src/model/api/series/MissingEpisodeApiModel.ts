import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import Series from '../../../db/entities/Series';
import IProgramDB from '../../db/IProgramDB';
import ISeriesDB from '../../db/ISeriesDB';
import ISyobocalTitleDB from '../../db/ISyobocalTitleDB';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import IMetadataService from '../../metadata/IMetadataService';
import { analyzeSeriesContinuity } from '../../series/SeriesContinuity';
import { parseSeriesInfo } from '../../series/SeriesNormalizer';
import IReserveApiModel from '../reserve/IReserveApiModel';
import IMissingEpisodeApiModel, {
    MissingEpisodeProposal,
    MissingEpisodeProposalCandidate,
} from './IMissingEpisodeApiModel';

/**
 * 欠番話数の補完予約提案 API (§4.7)。
 * - 欠番検出 (SeriesContinuity) を拡張し、外部メタデータの放送予定総話数・放送ペース補正まで
 *   考慮した欠番一覧に対し、EPG の未来分 (Program テーブル) から再放送候補を検索する
 * - 提案から予約を作成する際は SeriesReservationHint に airType: rerun を事前登録し、
 *   録画完了時に SeriesResolver がこれを優先して使う
 */
@injectable()
export default class MissingEpisodeApiModel implements IMissingEpisodeApiModel {
    private static readonly MAX_CANDIDATES = 10;

    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('ISeriesDB') private seriesDB: ISeriesDB,
        @inject('IProgramDB') private programDB: IProgramDB,
        @inject('IReserveApiModel') private reserveApi: IReserveApiModel,
        @inject('IMetadataService') private metadata: IMetadataService,
        @inject('ISyobocalTitleDB') private syobocalTitleDB: ISyobocalTitleDB,
    ) {}

    public async listProposals(seriesId: number): Promise<MissingEpisodeProposal[]> {
        this.enabled();
        const series = await this.seriesDB.getSeries(seriesId);
        if (!series) throw new Error('SeriesIsNotFound');
        const rows = await this.seriesDB.listRecorded(seriesId);
        const totalEpisodesBySeason = await this.externalTotals(series);
        const continuity = analyzeSeriesContinuity(rows, { totalEpisodesBySeason, now: Date.now() });

        const proposals: MissingEpisodeProposal[] = [];
        for (const missing of continuity.missingEpisodes) {
            const candidates = await this.searchFutureCandidates(series, missing.episodeNumber);
            if (candidates.length > 0) proposals.push({ ...missing, candidates });
        }
        return proposals;
    }

    public async reserveProposal(
        seriesId: number,
        seasonNumber: number,
        episodeNumber: number,
        programId: apid.ProgramId,
    ): Promise<apid.ReserveId> {
        this.enabled();
        const series = await this.seriesDB.getSeries(seriesId);
        if (!series) throw new Error('SeriesIsNotFound');
        const program = await this.programDB.findId(programId);
        if (!program) throw new Error('ProgramIsNotFound');

        const now = Date.now();
        let episode = await this.seriesDB.findEpisode(seriesId, seasonNumber, episodeNumber);
        if (!episode) {
            episode = await this.seriesDB.createEpisode({
                seriesId,
                seasonNumber,
                episodeNumber,
                episodeLabel: null,
                title: null,
                airedAt: null,
                createdAt: now,
                updatedAt: now,
            });
        }
        // 予約自体は通常の手動予約 API を再利用する (末尾切れは許容し、他の設定は既定値に委ねる)
        const reserveId = await this.reserveApi.add({ programId, allowEndLack: true });
        // 録画完了時に SeriesResolver が優先参照する airType: rerun ヒントを事前登録する (§4.7)
        await this.seriesDB.saveReservationHint({
            reserveId,
            seriesId,
            episodeId: episode.id,
            airType: 'rerun',
            createdAt: now,
        });
        return reserveId;
    }

    /**
     * EPG (Program テーブル、Mirakurun から取り込まれた未来分を含む) から再放送候補を探す。
     * しょぼいカレンダー ProgLookup の未来検索には対応していない (§備考: EPG ベースのみ)
     */
    private async searchFutureCandidates(
        series: Series,
        episodeNumber: number,
    ): Promise<MissingEpisodeProposalCandidate[]> {
        const searchOption: apid.RuleSearchOption = {
            keyword: series.title,
            name: true,
            GR: true,
            BS: true,
            CS: true,
            SKY: true,
        };
        for (let i = 1; i <= 40; i++) (searchOption as Record<string, unknown>)[`NW${i}`] = true;

        let programs;
        try {
            programs = await this.programDB.findRule({ searchOption });
        } catch {
            return [];
        }
        const now = Date.now();
        return programs
            .filter(p => Number(p.startAt) > now)
            .filter(p => {
                const parsed = parseSeriesInfo(p.name);
                if (parsed.normalizedTitle !== series.normalizedTitle) return false;
                return parsed.episodeNumber === null || parsed.episodeNumber === episodeNumber;
            })
            .sort((a, b) => Number(a.startAt) - Number(b.startAt))
            .slice(0, MissingEpisodeApiModel.MAX_CANDIDATES)
            .map(p => ({
                programId: p.id,
                channelId: p.channelId,
                name: p.name,
                startAt: Number(p.startAt),
                endAt: Number(p.endAt),
            }));
    }

    /**
     * 外部メタデータ (Annict / しょぼいカレンダー) から放送予定総話数を取得する。
     * メタデータ側はシーズン区分を持たないため、簡易的に season 1 の総話数として扱う (既知の制約)
     */
    private async externalTotals(series: Series): Promise<Record<number, number> | undefined> {
        if (!isFeatureEnabled(this.config.getConfig(), 'metadataProviders')) return undefined;

        // ローカルのしょぼいカレンダー作品辞書に総話数があれば、外部への問い合わせなしで済ませる
        if (series.syobocalTid !== null) {
            const dictionaryTitle = await this.syobocalTitleDB.get(series.syobocalTid).catch(() => null);
            if (dictionaryTitle !== null && dictionaryTitle.totalEpisodes !== null) {
                return { 1: dictionaryTitle.totalEpisodes };
            }
        }

        try {
            const work = series.annictId
                ? await this.metadata.get('annict', series.annictId)
                : series.syobocalTid
                  ? await this.metadata.get('syobocal', String(series.syobocalTid))
                  : null;
            const numbers = (work?.episodes ?? [])
                .map(x => x.number)
                .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
            if (numbers.length === 0) return undefined;
            return { 1: Math.max(...numbers) };
        } catch {
            return undefined;
        }
    }

    private enabled(): void {
        if (!isFeatureEnabled(this.config.getConfig(), 'seriesLibrary'))
            throw new Error('SeriesLibraryFeatureIsDisabled');
    }
}
