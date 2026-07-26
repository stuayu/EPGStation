import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import IRecordedApiModel from '../recorded/IRecordedApiModel';
import IRecordingApiModel from '../recording/IRecordingApiModel';
import IReserveApiModel from '../reserve/IReserveApiModel';
import IDashboardApiModel from './IDashboardApiModel';
@injectable()
export default class DashboardApiModel implements IDashboardApiModel {
    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('IRecordedApiModel') private recorded: IRecordedApiModel,
        @inject('IRecordingApiModel') private recording: IRecordingApiModel,
        @inject('IReserveApiModel') private reserves: IReserveApiModel,
    ) {}
    async get(isHalfWidth: boolean, limit: number): Promise<apid.DashboardData> {
        if (!isFeatureEnabled(this.config.getConfig(), 'dashboard')) throw new Error('DashboardFeatureIsDisabled');
        const safe = Math.min(50, Math.max(1, limit));
        const [recording, recentlyRecorded, upcomingReserves, reserveCounts] = await Promise.all([
            this.recording.gets({ isHalfWidth, offset: 0, limit: safe }),
            this.recorded.gets({ isHalfWidth, offset: 0, limit: safe }),
            this.reserves.gets({ type: 'normal', isHalfWidth, offset: 0, limit: safe }),
            this.reserves.getCnts(),
        ]);
        return { recording, recentlyRecorded, upcomingReserves, reserveCounts };
    }
}
