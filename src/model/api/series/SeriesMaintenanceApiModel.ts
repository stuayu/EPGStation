import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import ISeriesDB from '../../db/ISeriesDB';
import ISeriesMetadataFiller from '../../series/ISeriesMetadataFiller';
import ISeriesMaintenanceApiModel, {
    RefreshSeriesMetadataResult,
    UpdateSeriesMetadata,
    MergeSeriesResult,
    SplitSeriesResult,
} from './ISeriesMaintenanceApiModel';
@injectable()
export default class SeriesMaintenanceApiModel implements ISeriesMaintenanceApiModel {
    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('ISeriesDB') private db: ISeriesDB,
        @inject('ISeriesMetadataFiller') private metadataFiller: ISeriesMetadataFiller,
    ) {}

    private static readonly SEASON_NAMES: ReadonlySet<string> = new Set(['WINTER', 'SPRING', 'SUMMER', 'AUTUMN']);

    public async updateMetadata(seriesId: number, value: UpdateSeriesMetadata): Promise<void> {
        this.enabled();
        const series = await this.db.getSeries(seriesId);
        if (series === null) throw new Error('SeriesIsNotFound');

        const patch: {
            titleKana?: string | null;
            seasonYear?: number | null;
            seasonName?: string | null;
            seasonSource?: string | null;
            totalEpisodes?: number | null;
        } = {};

        if (typeof value.titleKana !== 'undefined') {
            const kana = value.titleKana === null ? null : String(value.titleKana).trim();
            patch.titleKana = kana === '' ? null : kana;
        }
        if (typeof value.totalEpisodes !== 'undefined') {
            const total = value.totalEpisodes === null ? null : Number(value.totalEpisodes);
            if (total !== null && (Number.isInteger(total) === false || total < 0 || total > 10000)) {
                throw new Error('InvalidRequestBody');
            }
            patch.totalEpisodes = total;
        }
        // クールは年と季節をセットで扱う (片方だけ入っていても絞り込みに使えないため)
        if (typeof value.seasonYear !== 'undefined' || typeof value.seasonName !== 'undefined') {
            const year =
                value.seasonYear === null || typeof value.seasonYear === 'undefined' ? null : Number(value.seasonYear);
            const name =
                value.seasonName === null || typeof value.seasonName === 'undefined'
                    ? null
                    : String(value.seasonName).toUpperCase();
            if (year === null && name === null) {
                patch.seasonYear = null;
                patch.seasonName = null;
                patch.seasonSource = null;
            } else {
                if (year === null || Number.isInteger(year) === false || year < 1950 || year > 2200) {
                    throw new Error('InvalidRequestBody');
                }
                if (name === null || SeriesMaintenanceApiModel.SEASON_NAMES.has(name) === false) {
                    throw new Error('InvalidRequestBody');
                }
                patch.seasonYear = year;
                patch.seasonName = name;
                // 手動設定は自動補完で上書きさせない
                patch.seasonSource = 'manual';
            }
        }

        if (Object.keys(patch).length === 0) return;
        await this.db.updateExternalMetadata(seriesId, patch);
    }

    public async refreshMetadata(): Promise<RefreshSeriesMetadataResult> {
        this.enabled();
        return await this.metadataFiller.fill();
    }

    async merge(fromSeriesId: number, toSeriesId: number): Promise<MergeSeriesResult> {
        this.enabled();
        if (typeof fromSeriesId !== 'number' || typeof toSeriesId !== 'number') throw new Error('InvalidRequestBody');
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
