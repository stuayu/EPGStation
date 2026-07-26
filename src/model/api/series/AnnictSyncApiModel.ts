import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import ISeriesDB from '../../db/ISeriesDB';
import IMetadataService from '../../metadata/IMetadataService';
import IAnnictSyncQueueModel from '../../metadata/annict/IAnnictSyncQueueModel';
import IAnnictSyncApiModel, { AnnictSyncResult } from './IAnnictSyncApiModel';
@injectable()
export default class AnnictSyncApiModel implements IAnnictSyncApiModel {
    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('ISeriesDB') private db: ISeriesDB,
        @inject('IMetadataService') private metadata: IMetadataService,
        @inject('IAnnictSyncQueueModel') private queue: IAnnictSyncQueueModel,
    ) {}
    async sync(seriesId: number): Promise<AnnictSyncResult> {
        const c = this.config.getConfig();
        if (!isFeatureEnabled(c, 'metadataProviders') || !isFeatureEnabled(c, 'annictSync'))
            throw new Error('AnnictSyncFeatureIsDisabled');
        const series = await this.db.getSeries(seriesId);
        if (!series) throw new Error('SeriesIsNotFound');
        // syobocalTid が既に確定していれば、それをキーに一意確定する (タイトル文字列一致より優先。§5.5)
        const context = series.syobocalTid ? { syobocalTid: Number(series.syobocalTid) } : undefined;
        const results = await this.metadata.search(series.title, context, ['annict']);
        const exact = context ? results.find(x => x.syobocalTid === context.syobocalTid) : undefined;
        const best = exact ?? results[0];
        if (!best || (!exact && best.score < 0.75)) throw new Error('AnnictWorkIsNotFound');
        await this.db.updateExternalMetadata(seriesId, {
            annictId: best.externalId,
            syobocalTid: best.syobocalTid ?? series.syobocalTid,
        });
        return {
            seriesId,
            annictId: best.externalId,
            syobocalTid: best.syobocalTid ?? series.syobocalTid,
            title: best.title,
            score: best.score,
        };
    }
    async syncWatchRecords(seriesId: number): Promise<{ queued: number }> {
        const c = this.config.getConfig();
        if (!isFeatureEnabled(c, 'metadataProviders') || !isFeatureEnabled(c, 'annictSync'))
            throw new Error('AnnictSyncFeatureIsDisabled');
        return await this.queue.enqueueSeries(seriesId);
    }
}
