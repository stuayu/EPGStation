import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../../api/IRepositoryModel';
import IDashboardState from './IDashboardState';

@injectable()
export default class DashboardState implements IDashboardState {
    private repository: IRepositoryModel;
    private data: apid.DashboardData | null = null;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    private cnts: apid.ReserveCnts = {
        normal: 0,
        conflicts: 0,
        skips: 0,
        overlaps: 0,
    };

    /**
     * 取得した予約数情報をクリア
     */
    public clearDate(): void {
        this.cnts = {
            normal: 0,
            conflicts: 0,
            skips: 0,
            overlaps: 0,
        };
    }

    /**
     * 予約数情報を取得
     * @return Promise<void>
     */
    public async fetchData(): Promise<void> {
        const result = await this.repository.get('/dashboard', { params: { limit: 5 } });
        this.data = result.data;
        this.cnts = this.data?.reserveCounts ?? this.cnts;
    }

    public getConflictCnt(): number {
        return this.cnts.conflicts;
    }
}
