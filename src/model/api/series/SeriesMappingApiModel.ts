import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import RecordedSeriesLink from '../../../db/entities/RecordedSeriesLink';
import IRecordedDB from '../../db/IRecordedDB';
import ISeriesDB from '../../db/ISeriesDB';
import ISeriesResolver from '../../series/ISeriesResolver';
import { normalizeSeriesTitle } from '../../series/SeriesNormalizer';
import * as apid from '../../../../api';
import ISeriesMappingApiModel, {
    BulkUpdateSeriesMappingOption,
    BulkUpdateSeriesMappingResult,
    SeriesMappingValue,
    UpdateSeriesMappingOption,
} from './ISeriesMappingApiModel';
@injectable()
export default class SeriesMappingApiModel implements ISeriesMappingApiModel {
    // 一括更新の 1 リクエストあたりの上限 (シリーズ 1 本の録画数を大きく上回る値)
    private static readonly BULK_LIMIT = 500;

    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('IRecordedDB') private recordedDB: IRecordedDB,
        @inject('ISeriesDB') private seriesDB: ISeriesDB,
        @inject('ISeriesResolver') private resolver: ISeriesResolver,
    ) {}
    async get(recordedId: number): Promise<SeriesMappingValue | null> {
        this.enabled();
        const link = await this.seriesDB.findLink(recordedId);
        if (!link) return null;
        const [recorded, series, episode] = await Promise.all([
            this.recordedDB.findId(recordedId),
            this.seriesDB.getSeries(link.seriesId),
            link.episodeId === null ? Promise.resolve(null) : this.seriesDB.findEpisodeById(link.episodeId),
        ]);
        if (!recorded || !series) return null;
        return {
            recordedId,
            recordedTitle: recorded.name,
            seriesId: series.id,
            seriesTitle: series.title,
            episodeId: episode?.id ?? null,
            seasonNumber: episode?.seasonNumber ?? null,
            episodeNumber: episode?.episodeNumber ?? null,
            episodeTitle: episode?.title ?? null,
            episodeComment: episode?.comment ?? null,
            episodeCommentSource: (episode?.commentSource ?? null) as SeriesMappingValue['episodeCommentSource'],
            airType: link.airType,
            matchMethod: link.matchMethod,
            confidence: link.confidence,
            manualLock: link.manualLock,
        };
    }
    async update(recordedId: number, option: UpdateSeriesMappingOption): Promise<SeriesMappingValue> {
        this.enabled();
        if (typeof option !== 'object' || option === null) throw new Error('InvalidRequestBody');
        const recorded = await this.recordedDB.findId(recordedId);
        if (!recorded) throw new Error('RecordedIsNotFound');
        const previous = await this.seriesDB.findLink(recordedId);
        let series = typeof option.seriesId === 'number' ? await this.seriesDB.getSeries(option.seriesId) : null;
        const now = Date.now();
        if (!series && typeof option.seriesTitle === 'string' && option.seriesTitle.trim()) {
            const title = option.seriesTitle.trim();
            series = await this.seriesDB.createSeries({
                title,
                normalizedTitle: normalizeSeriesTitle(title),
                preferredChannelId: recorded.channelId,
                createdAt: now,
                updatedAt: now,
            });
        }
        if (!series) throw new Error('SeriesIsNotFound');
        const season = this.integer(option.seasonNumber ?? 1, 'seasonNumber', 1);
        const number = this.episode(option.episodeNumber);
        let episode = null;
        if (number !== null) {
            episode = await this.seriesDB.findEpisode(series.id, season, number);
            if (!episode)
                episode = await this.seriesDB.createEpisode({
                    seriesId: series.id,
                    seasonNumber: season,
                    episodeNumber: number,
                    episodeLabel: `第${number}話`,
                    title: null,
                    airedAt: recorded.startAt,
                    createdAt: now,
                    updatedAt: now,
                });
        }
        const airType = this.airType(option.airType);
        await this.seriesDB.addHistory({ recordedId, action: 'assign', previous, createdAt: now });
        await this.seriesDB.saveLink({
            recordedId,
            seriesId: series.id,
            channelId: recorded.channelId,
            episodeId: episode?.id ?? null,
            airType,
            matchMethod: 'manual',
            confidence: 1,
            manualLock: true,
            createdAt: now,
            updatedAt: now,
        });
        await this.seriesDB.deletePendingMatchByRecordedId(recordedId);
        // 手動修正を「正規化タイトル → シリーズ」の対応として辞書に学習させる (既定で有効)
        if (option.learnAlias !== false) {
            await this.seriesDB.upsertAlias(normalizeSeriesTitle(recorded.name), series.id, now);
        }
        const result = await this.get(recordedId);
        if (!result) throw new Error('SeriesMappingSaveFailed');
        return result;
    }
    public async updateBulk(option: BulkUpdateSeriesMappingOption): Promise<BulkUpdateSeriesMappingResult> {
        this.enabled();
        if (typeof option !== 'object' || option === null || Array.isArray(option.items) === false)
            throw new Error('InvalidRequestBody');
        if (option.items.length === 0) return { updated: 0, failed: [] };
        if (option.items.length > SeriesMappingApiModel.BULK_LIMIT) throw new Error('TooManyItems');

        const failed: BulkUpdateSeriesMappingResult['failed'] = [];
        let updated = 0;
        // 1 件失敗しても残りは反映したいので、録画ごとに独立して処理する
        for (const item of option.items) {
            const recordedId = Number(item?.recordedId);
            try {
                if (Number.isInteger(recordedId) === false) throw new Error('InvalidRecordedId');
                const link = await this.seriesDB.findLink(recordedId);
                if (link === null) throw new Error('SeriesMappingIsNotFound');
                const current = link.episodeId === null ? null : await this.seriesDB.findEpisodeById(link.episodeId);
                // 指定の無い項目は現在値を維持する (話数だけ・放送種別だけの一括更新を可能にするため)
                await this.update(recordedId, {
                    seriesId: link.seriesId,
                    seasonNumber: item.seasonNumber ?? current?.seasonNumber ?? 1,
                    episodeNumber:
                        typeof item.episodeNumber === 'undefined'
                            ? (current?.episodeNumber ?? null)
                            : item.episodeNumber,
                    airType: item.airType ?? (link.airType as apid.SeriesAirType),
                    // 話数の付け直しでタイトル辞書を汚さないよう、学習は明示指定時のみ行う
                    learnAlias: option.learnAlias === true,
                });
                updated++;
            } catch (err) {
                failed.push({ recordedId, message: err instanceof Error ? err.message : String(err) });
            }
        }
        return { updated, failed };
    }

    async remove(recordedId: number): Promise<void> {
        this.enabled();
        const previous = await this.seriesDB.findLink(recordedId);
        if (!previous) return;
        await this.seriesDB.addHistory({ recordedId, action: 'unassign', previous, createdAt: Date.now() });
        await this.seriesDB.deleteLink(recordedId);
        // 割当解除後は自動判定へ差し戻す (§4.5 / 手動ロック解除時の再解決漏れの修正)
        const recorded = await this.recordedDB.findId(recordedId);
        if (recorded) {
            await this.resolver
                .resolve({
                    recordedId,
                    title: recorded.name,
                    channelId: recorded.channelId,
                    startAt: recorded.startAt,
                })
                .catch(() => null);
        }
    }
    async undo(recordedId: number): Promise<SeriesMappingValue | null> {
        this.enabled();
        const history = await this.seriesDB.getLatestHistoryForRecorded(recordedId);
        if (!history) throw new Error('SeriesChangeHistoryIsNotFound');
        // 変更前の状態へ復元する。previousSeriesId が無い (assign 前は未割当だった) 場合はリンクを削除する
        if (history.previousSeriesId === null) {
            await this.seriesDB.deleteLink(recordedId);
        } else {
            const recorded = await this.recordedDB.findId(recordedId);
            if (!recorded) throw new Error('RecordedIsNotFound');
            await this.seriesDB.saveLink({
                recordedId,
                seriesId: history.previousSeriesId,
                channelId: recorded.channelId,
                episodeId: history.previousEpisodeId,
                airType: (history.previousAirType ?? 'unknown') as RecordedSeriesLink['airType'],
                matchMethod: (history.previousMatchMethod ?? 'manual') as RecordedSeriesLink['matchMethod'],
                confidence: history.previousConfidence ?? 1,
                manualLock: history.previousManualLock ?? true,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
        }
        await this.seriesDB.markHistoryUndone(history.id);
        return await this.get(recordedId);
    }
    private enabled() {
        if (!isFeatureEnabled(this.config.getConfig(), 'seriesLibrary'))
            throw new Error('SeriesLibraryFeatureIsDisabled');
    }
    private integer(value: unknown, name: string, min: number): number {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < min) throw new Error(`Invalid${name}`);
        return value;
    }
    private episode(value: unknown): number | null {
        if (value === null || typeof value === 'undefined') return null;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('InvalidEpisodeNumber');
        return value;
    }
    private airType(value: unknown): 'first' | 'rerun' | 'delayed' | 'unknown' {
        return value === 'first' || value === 'rerun' || value === 'delayed' || value === 'unknown' ? value : 'unknown';
    }
}
