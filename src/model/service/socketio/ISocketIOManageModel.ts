import * as http from 'http';

export default interface ISocketIOManageModel {
    initialize(servers: http.Server[]): void;
    notifyClient(): void;
    /**
     * EIT[p/f] 相当 (現在放送中 / 直後に始まる番組) の更新をクライアントへ通知する
     * @param channelIds: number[] 対象の放送局
     */
    notifyOnAirProgramUpdated(channelIds: number[]): void;
    notifyUpdateEncodeProgress(): void;
}
