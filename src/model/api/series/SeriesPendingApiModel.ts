import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import IRecordedDB from '../../db/IRecordedDB';
import ISeriesDB from '../../db/ISeriesDB';
import SeriesDB from '../../db/SeriesDB';
import ISeriesMappingApiModel, { SeriesMappingValue, UpdateSeriesMappingOption } from './ISeriesMappingApiModel';
import ISeriesPendingApiModel, { PendingListResult } from './ISeriesPendingApiModel';
@injectable()
export default class SeriesPendingApiModel implements ISeriesPendingApiModel {
    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('IRecordedDB') private recordedDB: IRecordedDB,
        @inject('ISeriesDB') private seriesDB: ISeriesDB,
        @inject('ISeriesMappingApiModel') private mappingApiModel: ISeriesMappingApiModel,
    ) {}
    async list(offset: number, limit: number): Promise<PendingListResult> {
        this.enabled();
        const safeLimit = Math.min(100, Math.max(1, limit));
        const safeOffset = Math.max(0, offset);
        const [items, total] = await this.seriesDB.listPendingMatches(safeOffset, safeLimit);
        const recordedItems = await Promise.all(items.map(x => this.recordedDB.findId(x.recordedId)));
        return {
            items: items.map((x, i) => ({
                id: x.id,
                recordedId: x.recordedId,
                recordedTitle: recordedItems[i]?.name ?? '',
                normalizedTitle: x.normalizedTitle,
                channelId: x.channelId,
                candidates: SeriesDB.parsePendingCandidates(x.candidatesJson),
                createdAt: Number(x.createdAt),
            })),
            total,
        };
    }
    async confirm(pendingId: number, option: UpdateSeriesMappingOption): Promise<SeriesMappingValue> {
        this.enabled();
        const pending = await this.seriesDB.getPendingMatch(pendingId);
        if (!pending) throw new Error('PendingMatchIsNotFound');
        // update() 側で該当 recordedId の未確定キューは自動的に削除される
        return await this.mappingApiModel.update(pending.recordedId, option);
    }
    async reject(pendingId: number): Promise<void> {
        this.enabled();
        const pending = await this.seriesDB.getPendingMatch(pendingId);
        if (!pending) return;
        await this.seriesDB.deletePendingMatch(pendingId);
    }
    private enabled() {
        if (!isFeatureEnabled(this.config.getConfig(), 'seriesLibrary'))
            throw new Error('SeriesLibraryFeatureIsDisabled');
    }
}
