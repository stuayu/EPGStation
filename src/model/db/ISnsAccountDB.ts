import SnsAccount, { SnsAccountProvider } from '../../db/entities/SnsAccount';

export default interface ISnsAccountDB {
    /**
     * 新規に SNS 連携アカウントを 1 件追加する
     * @param account: SnsAccount
     * @return Promise<number> 追加した id
     */
    insertOnce(account: SnsAccount): Promise<number>;
    /**
     * SNS 連携アカウントを更新する
     * @param account: SnsAccount
     * @return Promise<void>
     */
    update(account: SnsAccount): Promise<void>;
    /**
     * SNS 連携アカウントを削除する
     * @param id: number
     * @return Promise<void>
     */
    delete(id: number): Promise<void>;
    /**
     * id で 1 件取得する
     * @param id: number
     * @return Promise<SnsAccount | null>
     */
    findById(id: number): Promise<SnsAccount | null>;
    /**
     * ログインユーザーの連携アカウント一覧を取得する
     * @param userId: number | null 認証無効・匿名時は null (共有枠)
     * @return Promise<SnsAccount[]>
     */
    findByUser(userId: number | null): Promise<SnsAccount[]>;
    /**
     * 同一アカウントの二重登録防止用の重複チェック
     * @param provider: SnsAccountProvider
     * @param userId: number | null
     * @param remoteUserId: string
     * @param instanceUrl: string | null
     * @return Promise<SnsAccount | null>
     */
    findDuplicate(
        provider: SnsAccountProvider,
        userId: number | null,
        remoteUserId: string,
        instanceUrl: string | null,
    ): Promise<SnsAccount | null>;
}
