import * as socketIo from 'socket.io-client';

export const UPDATE_EVENT = 'updateStatus';

/**
 * 番組情報更新通知の内容。
 * EIT[p/f] の窓 (現在〜10 分先) の外で起きた変更も含むため、
 * 受け取った側は表示している時間帯と重なるときだけ反応する
 */
export interface ProgramUpdatePayload {
    // 変更のあった放送局 id
    channelIds: number[];
    // 変更のあった番組の時間帯 (UnixtimeMS)。分からない場合は null
    startAt: number | null;
    endAt: number | null;
}

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
    /**
     * 番組情報の更新通知。
     * payload には変更のあった放送局 id と時間帯が入る
     */
    onUpdateProgram(callback: (payload: ProgramUpdatePayload) => void): void;
    offUpdateProgram(callback: (payload: ProgramUpdatePayload) => void): void;
    onUpdateEncodeState(callback: () => void): void;
    offUpdateEncodeState(callback: () => void): void;
}
