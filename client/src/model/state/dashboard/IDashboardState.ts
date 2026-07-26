import * as apid from '../../../../../api';

export default interface IDashboardState {
    clearDate(): void;
    fetchData(isHalfWidth: boolean, limit?: number): Promise<void>;
    getConflictCnt(): number;
    /**
     * featureFlags.dashboard が有効か
     * @return boolean
     */
    isEnabled(): boolean;
    /**
     * fetchData で取得した集約データ
     * 機能フラグが無効、もしくは取得に失敗した場合は null (呼び出し側は個別 API へフォールバックすること)
     * @return apid.DashboardData | null
     */
    getData(): apid.DashboardData | null;
}
