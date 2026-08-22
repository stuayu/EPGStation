import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import ISnsApiModel from '../../api/sns/ISnsApiModel';
import ISnsTimelineState from './ISnsTimelineState';

/**
 * SnsTimelineState
 * 視聴画面の SNS タイムラインタブ用の State。
 * タイムライン本体 (notes 配列) は WebSocket 差し込み・ページング追加・楽観更新など
 * 変化が激しく Vue のリアクティブ監視に乗せる必要があるため、あえてここでは保持せず
 * `SnsTimelinePanel.vue` 側のコンポーネントデータとして持たせる。
 * このクラスは API 呼び出しの薄いラッパーと、カスタム絵文字一覧のキャッシュのみを担う
 */
@injectable()
export default class SnsTimelineState implements ISnsTimelineState {
    // アカウント id ごとのカスタム絵文字一覧キャッシュ (セッション内のみ。サーバー側にも別途 TTL キャッシュがある)
    private emojiCache: Map<apid.SnsAccountId, apid.SnsMisskeyEmoji[]> = new Map();

    constructor(@inject('ISnsApiModel') private apiModel: ISnsApiModel) {}

    public async getTimeline(
        accountId: apid.SnsAccountId,
        type?: apid.SnsTimelineType,
        channelId?: string,
        limit?: number,
        cursor?: string,
    ): Promise<apid.SnsTimeline> {
        return await this.apiModel.getTimeline(accountId, type, channelId, limit, cursor);
    }

    public async getMisskeyEmojis(accountId: apid.SnsAccountId, force: boolean = false): Promise<apid.SnsMisskeyEmoji[]> {
        if (force === false) {
            const cached = this.emojiCache.get(accountId);
            if (typeof cached !== 'undefined') {
                return cached;
            }
        }

        const emojis = (await this.apiModel.getMisskeyEmojis(accountId)).emojis;
        this.emojiCache.set(accountId, emojis);

        return emojis;
    }

    public async addReaction(option: apid.SnsReactionOption): Promise<apid.SnsReactionResult> {
        return await this.apiModel.addReaction(option);
    }

    public async removeReaction(option: apid.SnsReactionOption): Promise<apid.SnsReactionResult> {
        return await this.apiModel.removeReaction(option);
    }

    public async renote(option: apid.SnsRenoteOption): Promise<apid.SnsRenoteResult> {
        return await this.apiModel.renote(option);
    }
}
