import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import ISeriesDB from '../../db/ISeriesDB';
import ISeriesAliasApiModel, { SeriesAliasItem } from './ISeriesAliasApiModel';
@injectable()
export default class SeriesAliasApiModel implements ISeriesAliasApiModel {
    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('ISeriesDB') private db: ISeriesDB,
    ) {}
    async list(seriesId?: number): Promise<SeriesAliasItem[]> {
        this.enabled();
        const aliases = await this.db.listAlias(seriesId);
        const seriesItems = await Promise.all(aliases.map(a => this.db.getSeries(a.seriesId)));
        return aliases.map((a, i) => ({
            id: a.id,
            normalizedTitle: a.normalizedTitle,
            seriesId: a.seriesId,
            seriesTitle: seriesItems[i]?.title ?? '',
            createdAt: Number(a.createdAt),
        }));
    }
    async remove(aliasId: number): Promise<void> {
        this.enabled();
        await this.db.deleteAlias(aliasId);
    }
    private enabled() {
        if (!isFeatureEnabled(this.config.getConfig(), 'seriesLibrary'))
            throw new Error('SeriesLibraryFeatureIsDisabled');
    }
}
