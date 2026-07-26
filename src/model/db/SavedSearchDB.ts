import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import SavedSearch from '../../db/entities/SavedSearch';
import IPromiseRetry from '../IPromiseRetry';
import IDBOperator from './IDBOperator';
import ISavedSearchDB, { FindAllSavedSearchOption } from './ISavedSearchDB';

@injectable()
export default class SavedSearchDB implements ISavedSearchDB {
    private op: IDBOperator;
    private promieRetry: IPromiseRetry;

    constructor(@inject('IDBOperator') op: IDBOperator, @inject('IPromiseRetry') promieRetry: IPromiseRetry) {
        this.op = op;
        this.promieRetry = promieRetry;
    }

    /**
     * 保存検索を 1 件挿入
     * @param item: SavedSearch
     * @return Promise<apid.SavedSearchId> inserted id
     */
    public async insertOnce(item: SavedSearch): Promise<apid.SavedSearchId> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().insert().into(SavedSearch).values(item);
        const insertedResult = await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });

        return insertedResult.identifiers[0].id;
    }

    /**
     * 保存検索を更新
     * @param item: SavedSearch
     * @return Promise<void>
     */
    public async updateOnce(item: SavedSearch): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(SavedSearch)
            .set({
                name: item.name,
                query: item.query,
                isPinned: item.isPinned,
                updatedAt: item.updatedAt,
            })
            .where({ id: item.id });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * searchId を指定して削除
     * @param searchId: apid.SavedSearchId
     * @return Promise<void>
     */
    public async deleteOnce(searchId: apid.SavedSearchId): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().delete().from(SavedSearch).where({
            id: searchId,
        });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * searchId を指定して取得する
     * @param searchId: apid.SavedSearchId
     * @return Promise<SavedSearch | null>
     */
    public async findId(searchId: apid.SavedSearchId): Promise<SavedSearch | null> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.getRepository(SavedSearch).createQueryBuilder('saved_search').where({
            id: searchId,
        });
        const result = await this.promieRetry.run(() => {
            return queryBuilder.getOne();
        });

        return typeof result === 'undefined' ? null : result;
    }

    /**
     * 全件取得 (ピン留めを優先し、更新日時の新しい順)
     * @param option: FindAllSavedSearchOption
     * @return Promise<[SavedSearch[], number]>
     */
    public async findAll(option: FindAllSavedSearchOption): Promise<[SavedSearch[], number]> {
        const connection = await this.op.getConnection();

        let queryBuilder = connection
            .getRepository(SavedSearch)
            .createQueryBuilder('saved_search')
            .orderBy('saved_search.isPinned', 'DESC')
            .addOrderBy('saved_search.updatedAt', 'DESC');

        if (typeof option.offset !== 'undefined') {
            queryBuilder = queryBuilder.skip(option.offset);
        }
        if (typeof option.limit !== 'undefined') {
            queryBuilder = queryBuilder.take(option.limit);
        }

        return await this.promieRetry.run(() => {
            return queryBuilder.getManyAndCount();
        });
    }
}
