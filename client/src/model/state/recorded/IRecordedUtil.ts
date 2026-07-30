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
        // 詳細画面用。EPG 上の放送時間 (例: `07/30(水) 22:00 ~ 22:30 (30 分)`)
        epgTimeText: string;
        // 詳細画面用。実際に録画された時間 (例: `21:59:57 ~ 23:13:02 (1:13:05)`)。
        // 実測メタデータが無い場合は undefined
        recordedTimeText?: string;
        description?: string;
        extended?: string;
        genre?: string;
        // ジャンル / サブジャンルをチップ表示するための一覧 (genre1 ~ genre3 由来、重複なし)
        genreItems?: string[];
        // 録画タグ (色付きチップ表示用)。未設定・空の場合は undefined
        tags?: apid.RecordedTag[];
        topThumbnailPath: string;
        thumbnails?: apid.ThumbnailId[];
        videoFiles?: apid.VideoFile[];
        canStremingVideoFiles?: apid.VideoFile[];
        drop?: string;
        dropSimple?: string;
        hasDrop: boolean;
        watchStatus?: apid.WatchStatus;
        watchProgress?: number;
        // 放送局ロゴの URL (放送局が現在ロゴを保持している場合のみ設定)
        logoSrc?: string;
    };
    recordedItem: apid.RecordedItem;
    isSelected: boolean;
}

export default interface IRecordedUtil {
    convertRecordedItemToDisplayData(item: apid.RecordedItem, isHalfWidth: boolean): RecordedDisplayData;
}
