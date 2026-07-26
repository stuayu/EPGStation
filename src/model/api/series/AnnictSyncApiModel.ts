import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import ISeriesDB from '../../db/ISeriesDB';
import IMetadataService from '../../metadata/IMetadataService';
import IAnnictSyncApiModel, { AnnictSyncResult } from './IAnnictSyncApiModel';
@injectable()
export default class AnnictSyncApiModel implements IAnnictSyncApiModel {
    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('ISeriesDB') private db: ISeriesDB,
        @inject('IMetadataService') private metadata: IMetadataService,
    ) {}
    async sync(seriesId: number): Promise<AnnictSyncResult> {
        const c = this.config.getConfig();
        if (!isFeatureEnabled(c, 'metadataProviders') || !isFeatureEnabled(c, 'annictSync'))
            throw new Error('AnnictSyncFeatureIsDisabled');
        const series = await this.db.getSeries(seriesId);
        if (!series) throw new Error('SeriesIsNotFound');
        const results = await this.metadata.search(series.title, undefined, ['annict']);
        const best = results[0];
        if (!best || best.score < 0.75) throw new Error('AnnictWorkIsNotFound');
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
}
