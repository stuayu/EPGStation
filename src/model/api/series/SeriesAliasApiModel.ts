import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import ISeriesDB from '../../db/ISeriesDB';
import { normalizeSeriesTitle } from '../../series/SeriesNormalizer';
import ISeriesAliasApiModel, {
    BulkUpdateSeriesAliasOption,
    BulkUpdateSeriesAliasResult,
    SeriesAliasItem,
    UpdateSeriesAliasOption,
} from './ISeriesAliasApiModel';
@injectable()
export default class SeriesAliasApiModel implements ISeriesAliasApiModel {
    // 1 リクエストで扱うエイリアスの上限
    private static readonly BULK_LIMIT = 500;

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
            // 学習元 ('manual' / 'llm')。source 列の追加前に作られた行は 'manual' として扱う
            source: a.source ?? 'manual',
            createdAt: Number(a.createdAt),
        }));
    }
    public async update(aliasId: number, option: UpdateSeriesAliasOption): Promise<SeriesAliasItem> {
        this.enabled();
        return await this.updateOne(aliasId, option);
    }

    public async updateBulk(option: BulkUpdateSeriesAliasOption): Promise<BulkUpdateSeriesAliasResult> {
        this.enabled();
        if (typeof option !== 'object' || option === null || Array.isArray(option.items) === false)
            throw new Error('InvalidRequestBody');
        if (option.items.length === 0) return { updated: 0, removed: 0, failed: [] };
        if (option.items.length > SeriesAliasApiModel.BULK_LIMIT) throw new Error('TooManyItems');

        const failed: BulkUpdateSeriesAliasResult['failed'] = [];
        let updated = 0;
        let removed = 0;
        // 1 件失敗しても残りは反映する (数十件の誤学習をまとめて直す用途のため)
        for (const item of option.items) {
            const aliasId = Number(item?.aliasId);
            try {
                if (Number.isInteger(aliasId) === false) throw new Error('InvalidAliasId');
                if (item.remove === true) {
                    await this.db.deleteAlias(aliasId);
                    removed++;
                } else {
                    await this.updateOne(aliasId, item);
                    updated++;
                }
            } catch (err) {
                failed.push({ aliasId, message: err instanceof Error ? err.message : String(err) });
            }
        }
        return { updated, removed, failed };
    }

    /**
     * 1 件分の付け替え。付け替え先は seriesId 優先、無ければ seriesTitle で検索/新規作成する
     */
    private async updateOne(aliasId: number, option: UpdateSeriesAliasOption): Promise<SeriesAliasItem> {
        if (typeof option !== 'object' || option === null) throw new Error('InvalidRequestBody');
        const alias = await this.db.getAlias(aliasId);
        if (alias === null) throw new Error('SeriesAliasIsNotFound');

        const series = await this.resolveSeries(option);
        // 誤学習の修正なので、以後の自動学習で上書きされないよう手動扱いにする
        await this.db.updateAlias(aliasId, series.id, 'manual');
        return {
            id: alias.id,
            normalizedTitle: alias.normalizedTitle,
            seriesId: series.id,
            seriesTitle: series.title,
            source: 'manual',
            createdAt: Number(alias.createdAt),
        };
    }

    /**
     * 付け替え先シリーズを決める。seriesTitle 指定で既存に無ければ新規作成する
     */
    private async resolveSeries(option: UpdateSeriesAliasOption): Promise<{ id: number; title: string }> {
        if (typeof option.seriesId === 'number' && Number.isInteger(option.seriesId)) {
            const series = await this.db.getSeries(option.seriesId);
            if (series === null) throw new Error('SeriesIsNotFound');
            return { id: series.id, title: series.title };
        }

        const title = typeof option.seriesTitle === 'string' ? option.seriesTitle.trim() : '';
        if (title === '') throw new Error('InvalidRequestBody');
        const normalizedTitle = normalizeSeriesTitle(title);
        // 同じ正規化タイトルのシリーズがあれば再利用し、無ければ作る
        const existing = (await this.db.findCandidates(normalizedTitle)).find(
            x => x.normalizedTitle === normalizedTitle,
        );
        if (typeof existing !== 'undefined') return { id: existing.id, title: existing.title };

        const now = Date.now();
        const created = await this.db.createSeries({
            title,
            normalizedTitle,
            preferredChannelId: null,
            createdAt: now,
            updatedAt: now,
        });
        return { id: created.id, title: created.title };
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
