import * as apid from '../../../../../api';

export default interface ISnsApiModel {
    /**
     * SNS 連携アカウント一覧を取得する
     * @return Promise<apid.SnsAccountItems>
     */
    getAccounts(): Promise<apid.SnsAccountItems>;
    /**
     * SNS 連携アカウントの既定値 (公開範囲・チャンネル・ローカルのみ) を更新する
     * @param accountId: apid.SnsAccountId
     * @param option: apid.UpdateSnsAccountOption
     */
    updateAccount(accountId: apid.SnsAccountId, option: apid.UpdateSnsAccountOption): Promise<void>;
    /**
     * SNS 連携を解除する
     * @param accountId: apid.SnsAccountId
     */
    deleteAccount(accountId: apid.SnsAccountId): Promise<void>;
    /**
     * Bluesky へ App Password でログインし、連携アカウントとして保存する
     * @param option: apid.SnsBlueskyLoginOption
     * @return Promise<apid.SnsAccountItem>
     */
    loginBluesky(option: apid.SnsBlueskyLoginOption): Promise<apid.SnsAccountItem>;
    /**
     * Misskey の MiAuth 認証セッションを作成する
     * @param option: apid.SnsMisskeyAuthOption
     * @return Promise<apid.SnsMisskeyAuthSession>
     */
    createMisskeyAuthSession(option: apid.SnsMisskeyAuthOption): Promise<apid.SnsMisskeyAuthSession>;
    /**
     * Misskey のチャンネル一覧 (フォロー中 + 作成したもの) を取得する
     * @param accountId: apid.SnsAccountId
     * @return Promise<apid.SnsMisskeyChannels>
     */
    getMisskeyChannels(accountId: apid.SnsAccountId): Promise<apid.SnsMisskeyChannels>;
    /**
     * SNS へ投稿する
     * @param option: apid.SnsPostOption
     * @return Promise<apid.SnsPostResult>
     */
    post(option: apid.SnsPostOption): Promise<apid.SnsPostResult>;
    /**
     * SNS タイムラインを取得する
     * @param accountId: apid.SnsAccountId
     * @param type: apid.SnsTimelineType | undefined Misskey のみ有効。Bluesky は無視される
     * @param channelId: string | undefined type: 'channel' のとき必須
     * @param limit: number | undefined
     * @param cursor: string | undefined 前回のレスポンスの cursor
     * @return Promise<apid.SnsTimeline>
     */
    getTimeline(
        accountId: apid.SnsAccountId,
        type?: apid.SnsTimelineType,
        channelId?: string,
        limit?: number,
        cursor?: string,
    ): Promise<apid.SnsTimeline>;
    /**
     * Misskey のカスタム絵文字一覧を取得する
     * @param accountId: apid.SnsAccountId
     * @return Promise<apid.SnsMisskeyEmojis>
     */
    getMisskeyEmojis(accountId: apid.SnsAccountId): Promise<apid.SnsMisskeyEmojis>;
    /**
     * ノートへリアクションを付ける
     * @param option: apid.SnsReactionOption
     * @return Promise<apid.SnsReactionResult>
     */
    addReaction(option: apid.SnsReactionOption): Promise<apid.SnsReactionResult>;
    /**
     * ノートへのリアクションを取り消す
     * @param option: apid.SnsReactionOption
     * @return Promise<apid.SnsReactionResult>
     */
    removeReaction(option: apid.SnsReactionOption): Promise<apid.SnsReactionResult>;
    /**
     * ノートをリノート / repost する
     * @param option: apid.SnsRenoteOption
     * @return Promise<apid.SnsRenoteResult>
     */
    renote(option: apid.SnsRenoteOption): Promise<apid.SnsRenoteResult>;
}
