import * as apid from '../../../../../api';

export default interface IRecordedTagApiModel {
    /**
     * タグ一覧を取得する
     */
    gets(option?: apid.GetRecordedTagOption): Promise<apid.RecordedTags>;
    /**
     * タグを追加する
     * @param name: タグ名
     * @param color: 色
     * @param parentId: 親タグの id (階層タグ用、省略でトップレベル)
     * @return 追加されたタグの id
     */
    add(name: string, color: string, parentId?: number | null): Promise<apid.RecordedTagId>;
    /**
     * タグを更新する
     */
    update(tagId: apid.RecordedTagId, name: string, color: string, parentId?: number | null): Promise<void>;
    /**
     * タグを削除する
     */
    delete(tagId: apid.RecordedTagId): Promise<void>;
    /**
     * 録画番組とタグを関連付ける
     */
    setRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
    /**
     * 録画番組とタグの関連付けを削除する
     */
    deleteRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
}
