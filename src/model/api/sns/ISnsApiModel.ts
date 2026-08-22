import * as apid from '../../../../api';

export default interface ISnsApiModel {
    /**
     * ログインユーザーの SNS 連携アカウント一覧を取得する (credential は含めない)
     * @param userId: number | null 認証無効・匿名時は null (共有枠)
     * @return Promise<apid.SnsAccountItems>
     */
    getAccounts(userId: number | null): Promise<apid.SnsAccountItems>;
    /**
     * 既定の公開範囲・チャンネル・ローカルのみを更新する
     * @param userId: number | null
     * @param id: apid.SnsAccountId
     * @param option: apid.UpdateSnsAccountOption
     * @return Promise<void>
     */
    updateAccount(userId: number | null, id: apid.SnsAccountId, option: apid.UpdateSnsAccountOption): Promise<void>;
    /**
     * 連携を解除する
     * @param userId: number | null
     * @param id: apid.SnsAccountId
     * @return Promise<void>
     */
    deleteAccount(userId: number | null, id: apid.SnsAccountId): Promise<void>;
    /**
     * App Password で Bluesky にログインし、アカウントを保存する
     * @param userId: number | null
     * @param option: apid.SnsBlueskyLoginOption
     * @return Promise<apid.SnsAccountItem>
     */
    loginBluesky(userId: number | null, option: apid.SnsBlueskyLoginOption): Promise<apid.SnsAccountItem>;
    /**
     * Misskey の MiAuth 認証セッションを作成する
     * @param userId: number | null
     * @param option: apid.SnsMisskeyAuthOption
     * @param baseUrl: string コールバック URL 組み立て用 (`getRequestBaseUrl(req)`)
     * @return Promise<apid.SnsMisskeyAuthSession>
     */
    createMisskeyAuthSession(
        userId: number | null,
        option: apid.SnsMisskeyAuthOption,
        baseUrl: string,
    ): Promise<apid.SnsMisskeyAuthSession>;
    /**
     * MiAuth のコールバックを処理し、アカウントを保存する
     * @param userId: number | null
     * @param sessionId: string
     * @return Promise<void>
     */
    completeMisskeyAuth(userId: number | null, sessionId: string): Promise<void>;
    /**
     * Misskey のチャンネル一覧を取得する (設定画面用)
     * @param userId: number | null
     * @param accountId: apid.SnsAccountId
     * @return Promise<apid.SnsMisskeyChannels>
     */
    getMisskeyChannels(userId: number | null, accountId: apid.SnsAccountId): Promise<apid.SnsMisskeyChannels>;
    /**
     * 複数アカウントへ同時に投稿する。片方が失敗しても他方の結果は残す
     * @param userId: number | null
     * @param option: apid.SnsPostOption
     * @return Promise<apid.SnsPostResult>
     */
    post(userId: number | null, option: apid.SnsPostOption): Promise<apid.SnsPostResult>;
    /**
     * タイムラインを取得する。provider ごとの差を吸収した共通形で返す
     * @param userId: number | null
     * @param accountId: apid.SnsAccountId
     * @param type: apid.SnsTimelineType | undefined
     * @param channelId: string | undefined Misskey の type: 'channel' のとき必須
     * @param limit: number | undefined
     * @param cursor: string | undefined
     * @return Promise<apid.SnsTimeline>
     */
    getTimeline(
        userId: number | null,
        accountId: apid.SnsAccountId,
        type: apid.SnsTimelineType | undefined,
        channelId: string | undefined,
        limit: number | undefined,
        cursor: string | undefined,
    ): Promise<apid.SnsTimeline>;
    /**
     * Misskey のカスタム絵文字一覧を取得する (サーバー側でキャッシュ済み)
     * @param userId: number | null
     * @param accountId: apid.SnsAccountId
     * @return Promise<apid.SnsMisskeyEmojis>
     */
    getMisskeyEmojis(userId: number | null, accountId: apid.SnsAccountId): Promise<apid.SnsMisskeyEmojis>;
    /**
     * リアクションを付ける (Misskey: 絵文字リアクション、Bluesky: like)
     * @param userId: number | null
     * @param option: apid.SnsReactionOption
     * @return Promise<apid.SnsReactionResult>
     */
    addReaction(userId: number | null, option: apid.SnsReactionOption): Promise<apid.SnsReactionResult>;
    /**
     * リアクションを取り消す
     * @param userId: number | null
     * @param option: apid.SnsReactionOption
     * @return Promise<apid.SnsReactionResult>
     */
    removeReaction(userId: number | null, option: apid.SnsReactionOption): Promise<apid.SnsReactionResult>;
    /**
     * リノートする (Misskey: renote、Bluesky: repost)
     * @param userId: number | null
     * @param option: apid.SnsRenoteOption
     * @return Promise<apid.SnsRenoteResult>
     */
    renote(userId: number | null, option: apid.SnsRenoteOption): Promise<apid.SnsRenoteResult>;
}
