import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import ISeriesDB from '../../db/ISeriesDB';
import IWorkDictionary from '../../series/IWorkDictionary';
import ISeriesMaintenanceApiModel, {
    RefreshSeriesMetadataResult, MergeSeriesResult, SplitSeriesResult } from './ISeriesMaintenanceApiModel';
@injectable()
export default class SeriesMaintenanceApiModel implements ISeriesMaintenanceApiModel {
    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('ISeriesDB') private db: ISeriesDB,
        @inject('IWorkDictionary') private workDictionary: IWorkDictionary,
    ) {}

    public async refreshMetadata(): Promise<RefreshSeriesMetadataResult> {
        this.enabled();
        const all = await this.db.findAllSeries();
        let updated = 0;
        for (const series of all) {
            // 既に全項目そろっているシリーズは辞書を引かない
            if (
                series.titleKana !== null &&
                series.seasonYear !== null &&
                series.seasonName !== null &&
                series.totalEpisodes !== null
            ) {
                continue;
            }
            const match = await this.workDictionary.lookup(series.title).catch(() => null);
            if (match === null) continue;

            const patch: {
                syobocalTid?: number | null;
                annictId?: string | null;
                titleKana?: string | null;
                seasonYear?: number | null;
                seasonName?: string | null;
                totalEpisodes?: number | null;
            } = {};
            if (series.syobocalTid === null && match.syobocalTid !== null) patch.syobocalTid = match.syobocalTid;
            if (series.annictId === null && match.annictId !== null) patch.annictId = String(match.annictId);
            if (series.titleKana === null && match.titleKana !== null) patch.titleKana = match.titleKana;
            if (series.seasonYear === null && match.seasonYear !== null) patch.seasonYear = match.seasonYear;
            if (series.seasonName === null && match.seasonName !== null) patch.seasonName = match.seasonName;
            if (series.totalEpisodes === null && match.totalEpisodes !== null) {
                patch.totalEpisodes = match.totalEpisodes;
            }
            if (Object.keys(patch).length === 0) continue;
            await this.db.updateExternalMetadata(series.id, patch);
            updated++;
        }
        return { scanned: all.length, updated };
    }
    async merge(fromSeriesId: number, toSeriesId: number): Promise<MergeSeriesResult> {
        this.enabled();
        if (typeof fromSeriesId !== 'number' || typeof toSeriesId !== 'number')
            throw new Error('InvalidRequestBody');
        if (fromSeriesId === toSeriesId) throw new Error('InvalidRequestBody');
        const [from, to] = await Promise.all([this.db.getSeries(fromSeriesId), this.db.getSeries(toSeriesId)]);
        if (!from || !to) throw new Error('SeriesIsNotFound');
        const movedLinkCount = await this.db.mergeSeries(fromSeriesId, toSeriesId);
        return { movedLinkCount };
    }
    async split(seriesId: number, recordedIds: number[], newTitle: string): Promise<SplitSeriesResult> {
        this.enabled();
        if (!Array.isArray(recordedIds) || recordedIds.length === 0 || recordedIds.some(x => typeof x !== 'number'))
            throw new Error('InvalidRequestBody');
        if (typeof newTitle !== 'string' || newTitle.trim() === '') throw new Error('InvalidRequestBody');
        const source = await this.db.getSeries(seriesId);
        if (!source) throw new Error('SeriesIsNotFound');
        const newSeries = await this.db.splitSeries(seriesId, recordedIds, newTitle.trim());
        return { seriesId: newSeries.id, title: newSeries.title };
    }
    private enabled() {
        if (!isFeatureEnabled(this.config.getConfig(), 'seriesLibrary'))
            throw new Error('SeriesLibraryFeatureIsDisabled');
    }
}
