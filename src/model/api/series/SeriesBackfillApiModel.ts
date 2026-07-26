import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import IIPCClient from '../../ipc/IIPCClient';
import ISeriesBackfillApiModel, { SeriesBackfillOption, SeriesBackfillResult } from './ISeriesBackfillApiModel';
@injectable()
export default class SeriesBackfillApiModel implements ISeriesBackfillApiModel {
    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('IIPCClient') private ipc: IIPCClient,
    ) {}
    async start(option: SeriesBackfillOption): Promise<SeriesBackfillResult> {
        this.enabled();
        return await this.ipc.series.startBackfill({
            dryRun: option.dryRun === true,
            chunkSize: typeof option.chunkSize === 'number' ? option.chunkSize : undefined,
        });
    }
    async getStatus(): Promise<SeriesBackfillResult> {
        this.enabled();
        return await this.ipc.series.getBackfillStatus();
    }
    async cancel(): Promise<void> {
        this.enabled();
        await this.ipc.series.cancelBackfill();
    }
    private enabled() {
        if (!isFeatureEnabled(this.config.getConfig(), 'seriesLibrary'))
            throw new Error('SeriesLibraryFeatureIsDisabled');
    }
}
