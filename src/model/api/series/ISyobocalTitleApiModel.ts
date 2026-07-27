import {
    SyobocalTitleDictionaryStatus,
    SyobocalTitleSyncResult,
} from '../../metadata/syobocal/ISyobocalTitleDictionary';

export default interface ISyobocalTitleApiModel {
    /**
     * しょぼいカレンダーのアニメ作品タイトル辞書の状態を返す
     * @return Promise<SyobocalTitleDictionaryStatus>
     */
    getStatus(): Promise<SyobocalTitleDictionaryStatus>;
    /**
     * 作品タイトル辞書を今すぐ同期する
     * @param full: boolean true なら差分ではなく全件取り直す
     * @return Promise<SyobocalTitleSyncResult>
     */
    sync(full: boolean): Promise<SyobocalTitleSyncResult>;
}
