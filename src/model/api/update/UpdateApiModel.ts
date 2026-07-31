import { inject, injectable } from 'inversify';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import IIPCClient from '../../ipc/IIPCClient';
import IUpdateApiModel, { RunUpdateOption, UpdateJob, UpdateRestartResult, UpdateStatus } from './IUpdateApiModel';

@injectable()
export default class UpdateApiModel implements IUpdateApiModel {
    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('IIPCClient') private ipc: IIPCClient,
    ) {}

    public async getStatus(): Promise<UpdateStatus> {
        this.enabled();
        return await this.ipc.update.getStatus();
    }

    public async check(): Promise<UpdateStatus> {
        this.enabled();
        return await this.ipc.update.check();
    }

    public async run(option: RunUpdateOption): Promise<UpdateJob> {
        this.enabled();
        return await this.ipc.update.run(option ?? {});
    }

    public async getJob(): Promise<UpdateJob> {
        this.enabled();
        return await this.ipc.update.getJob();
    }

    public async restart(): Promise<UpdateRestartResult> {
        this.enabled();
        return await this.ipc.update.restart();
    }

    private enabled(): void {
        if (!isFeatureEnabled(this.config.getConfig(), 'updateNotification'))
            throw new Error('UpdateNotificationFeatureIsDisabled');
    }
}
