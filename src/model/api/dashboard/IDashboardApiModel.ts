import * as apid from '../../../../api';
export default interface IDashboardApiModel {
    get(isHalfWidth: boolean, limit: number): Promise<apid.DashboardData>;
}
