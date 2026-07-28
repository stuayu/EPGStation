import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import ISystemSettingApiModel from './ISystemSettingApiModel';
@injectable()
export default class SystemSettingApiModel implements ISystemSettingApiModel {
    constructor(@inject('IRepositoryModel') private repository: IRepositoryModel) {}
    async get(): Promise<apid.AppSettingValue> {
        return (await this.repository.get('/settings/system')).data;
    }
    async getEditableConfig(): Promise<apid.EditableConfig> {
        return (await this.repository.get('/settings/config')).data;
    }
    async update(value: Record<string, any>): Promise<apid.AppSettingUpdateResult> {
        return (await this.repository.put('/settings/system', value)).data;
    }
    async testNotification(targetName?: string): Promise<apid.NotificationTestResult> {
        return (await this.repository.post('/settings/system/test/notification', { targetName })).data;
    }
    async getHistory(key: string): Promise<apid.AppSettingHistoryItem[]> {
        return (await this.repository.get('/settings/system/history', { params: { key } })).data;
    }
    async rollback(key: string): Promise<apid.AppSettingUpdateResult> {
        return (await this.repository.post('/settings/system/rollback', { key })).data;
    }
    async getNotificationFailures(limit?: number): Promise<apid.NotificationFailureHistoryItem[]> {
        return (await this.repository.get('/settings/system/notifications/failures', { params: { limit } })).data;
    }
    async testAnnictConnection(): Promise<apid.AnnictConnectionTestResult> {
        return (await this.repository.post('/settings/system/test/annict', {})).data;
    }
    async getSyobocalChannelMap(): Promise<apid.SyobocalChannelMapEntry[]> {
        return (await this.repository.get('/settings/system/syobocal/channels')).data;
    }
    async updateSyobocalChannelMap(entries: apid.SyobocalChannelMapEntry[]): Promise<apid.SyobocalChannelMapEntry[]> {
        return (await this.repository.put('/settings/system/syobocal/channels', entries)).data;
    }
    async syncSharedData(): Promise<apid.SharedDataSyncResult> {
        return (await this.repository.post('/settings/system/shared-data/sync', {})).data;
    }
    async getSyobocalTitleStatus(): Promise<apid.SyobocalTitleDictionaryStatus> {
        return (await this.repository.get('/settings/system/syobocal/titles')).data;
    }
    async syncSyobocalTitles(full: boolean): Promise<apid.SyobocalTitleSyncResult> {
        return (await this.repository.post('/settings/system/syobocal/titles', { full })).data;
    }
    async getAnnictWorkStatus(): Promise<apid.AnnictWorkDictionaryStatus> {
        return (await this.repository.get('/settings/system/annict/works')).data;
    }
    async syncAnnictWorks(): Promise<apid.AnnictWorkSyncResult> {
        return (await this.repository.post('/settings/system/annict/works', {})).data;
    }
}
