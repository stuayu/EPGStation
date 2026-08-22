import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import ISnsApiModel from '../../api/sns/ISnsApiModel';
import ISnsAccountsState from './ISnsAccountsState';

/**
 * SnsAccountsState
 * SNS 連携アカウント設定画面 (`/settings/sns`) 用の State
 */
@injectable()
export default class SnsAccountsState implements ISnsAccountsState {
    private accounts: apid.SnsAccountItem[] = [];

    constructor(@inject('ISnsApiModel') private apiModel: ISnsApiModel) {}

    public async fetchAccounts(): Promise<void> {
        this.accounts = (await this.apiModel.getAccounts()).items;
    }

    public getAccounts(): apid.SnsAccountItem[] {
        return this.accounts;
    }

    public async loginBluesky(option: apid.SnsBlueskyLoginOption): Promise<void> {
        await this.apiModel.loginBluesky(option);
        await this.fetchAccounts();
    }

    public async createMisskeyAuthSession(option: apid.SnsMisskeyAuthOption): Promise<apid.SnsMisskeyAuthSession> {
        return await this.apiModel.createMisskeyAuthSession(option);
    }

    public async getMisskeyChannels(accountId: apid.SnsAccountId): Promise<apid.SnsMisskeyChannel[]> {
        return (await this.apiModel.getMisskeyChannels(accountId)).items;
    }

    public async updateAccount(accountId: apid.SnsAccountId, option: apid.UpdateSnsAccountOption): Promise<void> {
        await this.apiModel.updateAccount(accountId, option);
        await this.fetchAccounts();
    }

    public async deleteAccount(accountId: apid.SnsAccountId): Promise<void> {
        await this.apiModel.deleteAccount(accountId);
        await this.fetchAccounts();
    }
}
