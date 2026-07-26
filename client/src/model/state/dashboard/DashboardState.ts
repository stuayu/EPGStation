import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../../api/IRepositoryModel';
import IReservesApiModel from '../../api/reserves/IReservesApiModel';
import IServerConfigModel from '../../serverConfig/IServerConfigModel';
import { isFeatureEnabled } from '../../../util/FeatureFlags';
import IDashboardState from './IDashboardState';

@injectable()
export default class DashboardState implements IDashboardState {
    private repository: IRepositoryModel;
    private reservesApiModel: IReservesApiModel;
    private serverConfigModel: IServerConfigModel;
    private data: apid.DashboardData | null = null;

    constructor(
        @inject('IRepositoryModel') repository: IRepositoryModel,
        @inject('IReservesApiModel') reservesApiModel: IReservesApiModel,
        @inject('IServerConfigModel') serverConfigModel: IServerConfigModel,
    ) {
        this.repository = repository;
        this.reservesApiModel = reservesApiModel;
        this.serverConfigModel = serverConfigModel;
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
        this.data = null;
    }

    /**
     * featureFlags.dashboard が有効か
     * @return boolean
     */
    public isEnabled(): boolean {
        return isFeatureEnabled(this.serverConfigModel.getConfig(), 'dashboard');
    }

    /**
     * 取得した集約データを返す (未取得 / 機能無効 / フォールバック時は null)
     * @return apid.DashboardData | null
     */
    public getData(): apid.DashboardData | null {
        return this.data;
    }

    /**
     * ダッシュボード情報を取得する
     * featureFlags.dashboard が有効な場合は集約 API (`GET /api/dashboard`) から 1 リクエストで取得する
     * 無効な場合、もしくは集約 API の取得に失敗した場合は予約件数のみ個別 API から取得し、
     * getData() は null を返す (呼び出し側は録画中/録画済み/予約を個別 API で取得すること)
     * @param isHalfWidth: boolean
     * @param limit: number 取得件数 (1〜50件にクランプされる、既定 20)
     * @return Promise<void>
     */
    public async fetchData(isHalfWidth: boolean, limit = 20): Promise<void> {
        if (this.isEnabled() === true) {
            try {
                const result = await this.repository.get('/dashboard', { params: { isHalfWidth, limit } });
                this.data = result.data;
                this.cnts = this.data?.reserveCounts ?? this.cnts;

                return;
            } catch (err) {
                console.error(err);
                // 集約 API が失敗した場合は個別 API へフォールバックする
            }
        }

        this.data = null;
        this.cnts = await this.reservesApiModel.getCnts();
    }

    public getConflictCnt(): number {
        return this.cnts.conflicts;
    }
}
