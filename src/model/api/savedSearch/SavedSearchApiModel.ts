import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import SavedSearch from '../../../db/entities/SavedSearch';
import ISavedSearchDB from '../../db/ISavedSearchDB';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import ISavedSearchApiModel from './ISavedSearchApiModel';

@injectable()
export default class SavedSearchApiModel implements ISavedSearchApiModel {
    constructor(
        @inject('IConfiguration') private readonly config: IConfiguration,
        @inject('ISavedSearchDB') private readonly savedSearchDB: ISavedSearchDB,
    ) {}

    /**
     * 保存検索一覧を取得する
     * @param offset: number | undefined
     * @param limit: number | undefined
     * @return Promise<apid.SavedSearchItems>
     */
    public async gets(offset?: number, limit?: number): Promise<apid.SavedSearchItems> {
        this.ensureEnabled();

        const [items, total] = await this.savedSearchDB.findAll({ offset: offset, limit: limit });

        return {
            items: items.map(this.toApiItem),
            total: total,
        };
    }

    /**
     * 保存検索を 1 件取得する
     * @param searchId: apid.SavedSearchId
     * @return Promise<apid.SavedSearchItem>
     */
    public async get(searchId: apid.SavedSearchId): Promise<apid.SavedSearchItem> {
        this.ensureEnabled();

        const item = await this.savedSearchDB.findId(searchId);
        if (item === null) {
            throw new Error('SavedSearchIsNull');
        }

        return this.toApiItem(item);
    }

    /**
     * 保存検索を新規作成する
     * @param option: apid.AddSavedSearchOption
     * @return Promise<apid.SavedSearchId>
     */
    public async create(option: apid.AddSavedSearchOption): Promise<apid.SavedSearchId> {
        this.ensureEnabled();

        const now = Date.now();
        const newItem = new SavedSearch();
        newItem.name = option.name;
        newItem.query = option.query;
        newItem.isPinned = option.isPinned === true;
        newItem.createdAt = now;
        newItem.updatedAt = now;

        return await this.savedSearchDB.insertOnce(newItem);
    }

    /**
     * 保存検索を更新する
     * @param searchId: apid.SavedSearchId
     * @param option: apid.UpdateSavedSearchOption
     * @return Promise<void>
     */
    public async update(searchId: apid.SavedSearchId, option: apid.UpdateSavedSearchOption): Promise<void> {
        this.ensureEnabled();

        const item = await this.savedSearchDB.findId(searchId);
        if (item === null) {
            throw new Error('SavedSearchIsNull');
        }

        item.name = option.name;
        item.query = option.query;
        item.isPinned = option.isPinned === true;
        item.updatedAt = Date.now();

        await this.savedSearchDB.updateOnce(item);
    }

    /**
     * 保存検索を削除する
     * @param searchId: apid.SavedSearchId
     * @return Promise<void>
     */
    public async delete(searchId: apid.SavedSearchId): Promise<void> {
        this.ensureEnabled();

        await this.savedSearchDB.deleteOnce(searchId);
    }

    private toApiItem(item: SavedSearch): apid.SavedSearchItem {
        return {
            id: item.id,
            name: item.name,
            query: item.query,
            isPinned: item.isPinned,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
        };
    }

    private ensureEnabled(): void {
        if (!isFeatureEnabled(this.config.getConfig(), 'advancedSearch')) {
            throw new Error('AdvancedSearchFeatureIsDisabled');
        }
    }
}
