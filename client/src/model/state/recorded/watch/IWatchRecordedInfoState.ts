import * as apid from '../../../../../../api';

export interface DsiplayWatchInfo {
    // 放送局ロゴの URL を組み立てるために使う (ロゴを持たない放送局もあるため表示側で握りつぶす)
    channelId: apid.ChannelId | null;
    channelName: string;
    time: string;
    // 視聴画面上部のバーに出す短い時刻表記 (「05:57 ~ 06:07」)
    shortTime: string;
    name: string;
    description?: string;
    extended?: string;
}

export default interface IWatchRecordedInfoState {
    clear(): void;
    update(recordedId: apid.RecordedId): Promise<void>;
    getInfo(): DsiplayWatchInfo | null;
}
