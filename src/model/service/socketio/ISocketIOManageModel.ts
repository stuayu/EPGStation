import * as http from 'http';

export default interface ISocketIOManageModel {
    initialize(servers: http.Server[]): void;
    notifyClient(): void;
    /**
     * EIT[p/f] 相当 (現在放送中 / 直後に始まる番組) の更新をクライアントへ通知する
     * @param channelIds: number[] 対象の放送局
     */
    notifyOnAirProgramUpdated(channelIds: number[]): void;
    /**
     * 番組情報の更新を通知する (変更のあった放送局と時間帯を添える)
     * @param option: { channelIds: number[]; startAt: number | null; endAt: number | null }
     */
    notifyProgramUpdated(option: { channelIds: number[]; startAt: number | null; endAt: number | null }): void;
    notifyUpdateEncodeProgress(): void;
}
