import { inject, injectable } from 'inversify';
import IRepositoryModel from '../IRepositoryModel';
import ISystemSettingApiModel from './ISystemSettingApiModel';
@injectable()
export default class SystemSettingApiModel implements ISystemSettingApiModel {
    constructor(@inject('IRepositoryModel') private repository: IRepositoryModel) {}
    async get() {
        return (await this.repository.get('/settings/system')).data;
    }
    async update(value: Record<string, any>) {
        return (await this.repository.put('/settings/system', value)).data;
    }
}
