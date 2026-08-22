import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import ISnsApiModel from './ISnsApiModel';

/**
 * SnsApiModel
 * SNS (Bluesky / Misskey) 投稿機能の API ラッパー
 */
@injectable()
export default class SnsApiModel implements ISnsApiModel {
    constructor(@inject('IRepositoryModel') private repository: IRepositoryModel) {}

    public async getAccounts(): Promise<apid.SnsAccountItems> {
        return (await this.repository.get('/sns/accounts')).data;
    }

    public async updateAccount(accountId: apid.SnsAccountId, option: apid.UpdateSnsAccountOption): Promise<void> {
        await this.repository.put(`/sns/accounts/${accountId}`, option);
    }

    public async deleteAccount(accountId: apid.SnsAccountId): Promise<void> {
        await this.repository.delete(`/sns/accounts/${accountId}`);
    }

    public async loginBluesky(option: apid.SnsBlueskyLoginOption): Promise<apid.SnsAccountItem> {
        return (await this.repository.post('/sns/bluesky/login', option)).data;
    }

    public async createMisskeyAuthSession(option: apid.SnsMisskeyAuthOption): Promise<apid.SnsMisskeyAuthSession> {
        return (await this.repository.post('/sns/misskey/auth', option)).data;
    }

    public async getMisskeyChannels(accountId: apid.SnsAccountId): Promise<apid.SnsMisskeyChannels> {
        return (
            await this.repository.get('/sns/misskey/channels', {
                params: { accountId: accountId },
            })
        ).data;
    }

    public async post(option: apid.SnsPostOption): Promise<apid.SnsPostResult> {
        return (await this.repository.post('/sns/post', option)).data;
    }

    public async getTimeline(
        accountId: apid.SnsAccountId,
        type?: apid.SnsTimelineType,
        channelId?: string,
        limit?: number,
        cursor?: string,
    ): Promise<apid.SnsTimeline> {
        return (
            await this.repository.get('/sns/timeline', {
                params: { accountId: accountId, type: type, channelId: channelId, limit: limit, cursor: cursor },
            })
        ).data;
    }

    public async getMisskeyEmojis(accountId: apid.SnsAccountId): Promise<apid.SnsMisskeyEmojis> {
        return (
            await this.repository.get('/sns/misskey/emojis', {
                params: { accountId: accountId },
            })
        ).data;
    }

    public async addReaction(option: apid.SnsReactionOption): Promise<apid.SnsReactionResult> {
        return (await this.repository.post('/sns/reaction', option)).data;
    }

    public async removeReaction(option: apid.SnsReactionOption): Promise<apid.SnsReactionResult> {
        return (await this.repository.delete('/sns/reaction', { data: option })).data;
    }

    public async renote(option: apid.SnsRenoteOption): Promise<apid.SnsRenoteResult> {
        return (await this.repository.post('/sns/renote', option)).data;
    }
}
