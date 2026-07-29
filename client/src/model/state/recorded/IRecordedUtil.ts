import * as apid from '../../../../../api';

export interface RecordedDisplayData {
    display: {
        channelName: string;
        name: string;
        time: string;
        shortTime: string;
        duration: number; // 番組の長さ (分)
        fileDuration?: number; // 録画ファイルの実測の長さ (分)。未解析の場合は undefined
        durationText: string; // 一覧表示用の長さ (例: `30 m` / `30 m → 実 32 m`)
        description?: string;
        extended?: string;
        genre?: string;
        topThumbnailPath: string;
        thumbnails?: apid.ThumbnailId[];
        videoFiles?: apid.VideoFile[];
        canStremingVideoFiles?: apid.VideoFile[];
        drop?: string;
        dropSimple?: string;
        hasDrop: boolean;
        watchStatus?: apid.WatchStatus;
        watchProgress?: number;
    };
    recordedItem: apid.RecordedItem;
    isSelected: boolean;
}

export default interface IRecordedUtil {
    convertRecordedItemToDisplayData(item: apid.RecordedItem, isHalfWidth: boolean): RecordedDisplayData;
}
