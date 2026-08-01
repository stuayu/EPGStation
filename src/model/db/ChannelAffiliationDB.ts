import { inject, injectable } from 'inversify';
import ChannelAffiliation from '../../db/entities/ChannelAffiliation';
import IPromiseRetry from '../IPromiseRetry';
import IChannelAffiliationDB from './IChannelAffiliationDB';
import IDBOperator from './IDBOperator';

@injectable()
export default class ChannelAffiliationDB implements IChannelAffiliationDB {
    private op: IDBOperator;
    private promieRetry: IPromiseRetry;

    constructor(@inject('IDBOperator') op: IDBOperator, @inject('IPromiseRetry') promieRetry: IPromiseRetry) {
        this.op = op;
        this.promieRetry = promieRetry;
    }

    /**
     * 収集済みの系列情報を全件取得する
     * @return Promise<ChannelAffiliation[]>
     */
    public async findAll(): Promise<ChannelAffiliation[]> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.getRepository(ChannelAffiliation).createQueryBuilder();

        return await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });
    }

    /**
     * 指定した networkId の系列情報を置き換える
     * @param networkId: number
     * @param affiliationIds: number[] 系列識別の一覧
     * @return Promise<boolean> 内容が変化した場合は true
     */
    public async replace(networkId: number, affiliationIds: number[]): Promise<boolean> {
        const newIds = Array.from(new Set(affiliationIds)).sort((a, b) => a - b);

        const connection = await this.op.getConnection();
        const oldItems = await this.promieRetry.run(() => {
            return connection.getRepository(ChannelAffiliation).find({ where: { networkId: networkId } });
        });
        const oldIds = oldItems.map(i => i.affiliationId).sort((a, b) => a - b);

        // 変化が無ければ書き込まない (配信中に何度も BIT が流れてくるため)
        if (oldIds.length === newIds.length && oldIds.every((id, index) => id === newIds[index]) === true) {
            return false;
        }

        const updatedAt = new Date().getTime();
        const queryRunner = connection.createQueryRunner();
        await queryRunner.startTransaction();

        let hasError: Error | null = null;
        try {
            await queryRunner.manager
                .createQueryBuilder()
                .delete()
                .from(ChannelAffiliation)
                .where({ networkId: networkId })
                .execute();

            for (const affiliationId of newIds) {
                await queryRunner.manager.insert(ChannelAffiliation, {
                    networkId: networkId,
                    affiliationId: affiliationId,
                    updatedAt: updatedAt,
                });
            }
            await queryRunner.commitTransaction();
        } catch (err: any) {
            hasError = err;
            await queryRunner.rollbackTransaction();
        } finally {
            await queryRunner.release();
        }

        if (hasError !== null) {
            throw hasError;
        }

        return true;
    }
}
