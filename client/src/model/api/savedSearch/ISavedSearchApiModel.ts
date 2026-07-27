import * as apid from '../../../../../api';

export default interface ISavedSearchApiModel {
    /**
     * 保存検索一覧を取得する (advancedSearch 機能フラグ有効時のみ利用可能)
     */
    gets(offset?: number, limit?: number): Promise<apid.SavedSearchItems>;
    /**
     * 保存検索を 1 件取得する
     */
    get(searchId: apid.SavedSearchId): Promise<apid.SavedSearchItem>;
    /**
     * 保存検索を追加する
     * @param option: 検索名・検索条件 (JSON 文字列)・ピン留めするか
     * @return 追加された保存検索の id
     */
    add(option: apid.AddSavedSearchOption): Promise<apid.SavedSearchId>;
    /**
     * 保存検索を更新する (リネーム・条件更新・ピン留め切り替え)
     */
    update(searchId: apid.SavedSearchId, option: apid.UpdateSavedSearchOption): Promise<void>;
    /**
     * 保存検索を削除する
     */
    delete(searchId: apid.SavedSearchId): Promise<void>;
}
