import { AnnictWorkDictionaryStatus, AnnictWorkSyncResult } from '../../metadata/annict/IAnnictWorkDictionary';

export default interface IAnnictWorkApiModel {
    /**
     * Annict 作品辞書の状態を返す
     * @return Promise<AnnictWorkDictionaryStatus>
     */
    getStatus(): Promise<AnnictWorkDictionaryStatus>;
    /**
     * Annict 作品辞書を今すぐ同期する (Annict は差分取得に対応しないため常に全件取得)
     * @return Promise<AnnictWorkSyncResult>
     */
    sync(): Promise<AnnictWorkSyncResult>;
}
