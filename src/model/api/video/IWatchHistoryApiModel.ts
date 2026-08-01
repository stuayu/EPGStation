import * as apid from '../../../../api';
export default interface IWatchHistoryApiModel {
    get(id: apid.VideoFileId): Promise<apid.WatchHistory | null>;
    update(id: apid.VideoFileId, o: apid.UpdatePlaybackPositionOption): Promise<apid.WatchHistory | null>;
    /**
     * 視聴履歴を最後に見た順で取得する (対象の録画情報付き)
     * @param option: apid.GetWatchHistoryOption
     * @return Promise<apid.WatchHistoryRecords>
     */
    gets(option: apid.GetWatchHistoryOption): Promise<apid.WatchHistoryRecords>;
    /**
     * 視聴履歴を 1 件削除する
     * @param id: apid.VideoFileId
     * @return Promise<void>
     */
    delete(id: apid.VideoFileId): Promise<void>;
}
