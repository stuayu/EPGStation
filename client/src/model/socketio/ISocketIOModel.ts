import * as socketIo from 'socket.io-client';

export const UPDATE_EVENT = 'updateStatus';

export default interface ISocketIOModel {
    Iinitialize(): void;
    getIO(): socketIo.Socket | null;
    onUpdateState(callback: () => void): void;
    offUpdateState(callback: () => void): void;
    /**
     * EIT[p/f] 相当 (現在放送中 / 直後に始まる番組) の更新通知。
     * payload には更新があった放送局 id が入る
     */
    onUpdateOnAirProgram(callback: (payload: { channelIds: number[] }) => void): void;
    offUpdateOnAirProgram(callback: (payload: { channelIds: number[] }) => void): void;
    onUpdateEncodeState(callback: () => void): void;
    offUpdateEncodeState(callback: () => void): void;
}
