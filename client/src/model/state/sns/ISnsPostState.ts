import * as apid from '../../../../../api';

export default interface ISnsPostState {
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
     * 指定した Misskey アカウントのチャンネル一覧を取得する
     * @param accountId: apid.SnsAccountId
     * @return Promise<apid.SnsMisskeyChannel[]>
     */
    getMisskeyChannels(accountId: apid.SnsAccountId): Promise<apid.SnsMisskeyChannel[]>;
    /**
     * SNS へ投稿する
     * @param option: apid.SnsPostOption
     * @return Promise<apid.SnsPostResult>
     */
    post(option: apid.SnsPostOption): Promise<apid.SnsPostResult>;
}
