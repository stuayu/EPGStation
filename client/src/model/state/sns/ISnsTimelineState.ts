import * as apid from '../../../../../api';

export default interface ISnsTimelineState {
    /**
     * SNS タイムラインを取得する (ページング用の cursor をそのまま素通しする薄いラッパー)
     * @param accountId: apid.SnsAccountId
     * @param type: apid.SnsTimelineType | undefined
     * @param channelId: string | undefined
     * @param limit: number | undefined
     * @param cursor: string | undefined
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
     * Misskey のカスタム絵文字一覧を取得する。同じアカウントに対しては
     * セッション内で 1 度だけ取得しメモリキャッシュする (数千件返るインスタンスがあるため)
     * @param accountId: apid.SnsAccountId
     * @param force: boolean 既定 false。true の場合キャッシュを無視して取得し直す
     * @return Promise<apid.SnsMisskeyEmoji[]>
     */
    getMisskeyEmojis(accountId: apid.SnsAccountId, force?: boolean): Promise<apid.SnsMisskeyEmoji[]>;
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
