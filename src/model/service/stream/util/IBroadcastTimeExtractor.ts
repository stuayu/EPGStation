import * as stream from 'stream';

/**
 * TS から読み取った放送時刻
 */
export interface BroadcastTime {
    // TDT / TOT が示す放送時刻 (UNIX 時刻・ミリ秒)
    time: number;
    // その TDT / TOT を受信したサーバ時刻 (UNIX 時刻・ミリ秒)
    receivedAt: number;
}

export default interface IBroadcastTimeExtractor extends stream.Transform {
    getBroadcastTime(): BroadcastTime | null;
}
