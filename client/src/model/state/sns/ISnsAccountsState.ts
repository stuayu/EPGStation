import * as apid from '../../../../../api';

export default interface ISnsAccountsState {
    /**
     * 連携アカウント一覧を取得し直す
     */
    fetchAccounts(): Promise<void>;
    /**
     * 直近に取得した連携アカウント一覧を返す
     * @return apid.SnsAccountItem[]
     */
    getAccounts(): apid.SnsAccountItem[];
    /**
     * Bluesky へ App Password でログインする
     * @param option: apid.SnsBlueskyLoginOption
     */
    loginBluesky(option: apid.SnsBlueskyLoginOption): Promise<void>;
    /**
     * Misskey の MiAuth 認証セッションを作成する (成功したら authUrl へ遷移させること)
     * @param option: apid.SnsMisskeyAuthOption
     * @return Promise<apid.SnsMisskeyAuthSession>
     */
    createMisskeyAuthSession(option: apid.SnsMisskeyAuthOption): Promise<apid.SnsMisskeyAuthSession>;
    /**
     * 指定した Misskey アカウントのチャンネル一覧を取得する
     * @param accountId: apid.SnsAccountId
     * @return Promise<apid.SnsMisskeyChannel[]>
     */
    getMisskeyChannels(accountId: apid.SnsAccountId): Promise<apid.SnsMisskeyChannel[]>;
    /**
     * アカウントの既定値を更新する
     * @param accountId: apid.SnsAccountId
     * @param option: apid.UpdateSnsAccountOption
     */
    updateAccount(accountId: apid.SnsAccountId, option: apid.UpdateSnsAccountOption): Promise<void>;
    /**
     * 連携を解除する
     * @param accountId: apid.SnsAccountId
     */
    deleteAccount(accountId: apid.SnsAccountId): Promise<void>;
}
