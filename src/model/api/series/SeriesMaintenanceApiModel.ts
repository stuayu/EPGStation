import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import ISeriesDB from '../../db/ISeriesDB';
import ISeriesMaintenanceApiModel, { MergeSeriesResult, SplitSeriesResult } from './ISeriesMaintenanceApiModel';
@injectable()
export default class SeriesMaintenanceApiModel implements ISeriesMaintenanceApiModel {
    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('ISeriesDB') private db: ISeriesDB,
    ) {}
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
