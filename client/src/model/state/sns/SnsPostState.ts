import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import ISnsApiModel from '../../api/sns/ISnsApiModel';
import ISnsPostState from './ISnsPostState';

/**
 * SnsPostState
 * 視聴画面の SNS 投稿パネル用の State (連携アカウント一覧・投稿)
 */
@injectable()
export default class SnsPostState implements ISnsPostState {
    private accounts: apid.SnsAccountItem[] = [];

    constructor(@inject('ISnsApiModel') private apiModel: ISnsApiModel) {}

    public async fetchAccounts(): Promise<void> {
        this.accounts = (await this.apiModel.getAccounts()).items;
    }

    public getAccounts(): apid.SnsAccountItem[] {
        return this.accounts;
    }

    public async getMisskeyChannels(accountId: apid.SnsAccountId): Promise<apid.SnsMisskeyChannel[]> {
        return (await this.apiModel.getMisskeyChannels(accountId)).items;
    }

    public async post(option: apid.SnsPostOption): Promise<apid.SnsPostResult> {
        return await this.apiModel.post(option);
    }
}
