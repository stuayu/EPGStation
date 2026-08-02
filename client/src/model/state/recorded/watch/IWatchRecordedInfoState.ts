import * as apid from '../../../../../../api';

export interface DsiplayWatchInfo {
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
