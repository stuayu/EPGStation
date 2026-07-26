import * as apid from '../../../../api';
export default interface IWatchHistoryApiModel {
    get(id: apid.VideoFileId): Promise<apid.WatchHistory | null>;
    update(id: apid.VideoFileId, o: apid.UpdatePlaybackPositionOption): Promise<apid.WatchHistory | null>;
}
