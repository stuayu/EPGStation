import { inject, injectable } from 'inversify';
import IRepositoryModel from '../IRepositoryModel';
import IUpdateApiModel, { UpdateJob, UpdateRestartResult, UpdateStatus } from './IUpdateApiModel';

@injectable()
export default class UpdateApiModel implements IUpdateApiModel {
    constructor(@inject('IRepositoryModel') private repository: IRepositoryModel) {}

    public async getStatus(): Promise<UpdateStatus> {
        return (await this.repository.get('/update')).data;
    }
    public async check(): Promise<UpdateStatus> {
        return (await this.repository.post('/update/check', {})).data;
    }
    public async run(tag?: string, restart = true): Promise<UpdateJob> {
        return (await this.repository.post('/update/run', { tag, restart })).data;
    }
    public async runBranch(ref?: string, restart = true): Promise<UpdateJob> {
        return (await this.repository.post('/update/run', { refType: 'branch', ref, restart })).data;
    }
    public async getJob(): Promise<UpdateJob> {
        return (await this.repository.get('/update/job')).data;
    }
    public async restart(): Promise<UpdateRestartResult> {
        return (await this.repository.post('/update/restart', {})).data;
    }
}
