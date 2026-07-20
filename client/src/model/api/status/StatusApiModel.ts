import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IStatusApiModel from './IStatusApiModel';

@injectable()
export default class StatusApiModel implements IStatusApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    /**
     * 外部サービスとの接続状態を取得する
     * @return Promise<apid.Status>
     */
    public async getStatus(): Promise<apid.Status> {
        const result = await this.repository.get('/status');

        return result.data;
    }
}
