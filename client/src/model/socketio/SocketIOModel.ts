import { inject, injectable } from 'inversify';
import * as socketIo from 'socket.io-client';
import Util from '../../util/Util';
import IServerConfigModel from '../serverConfig/IServerConfigModel';
import ISocketIOModel from './ISocketIOModel';

@injectable()
class SocketIOModel implements ISocketIOModel {
    private serverConfiModel: IServerConfigModel;
    private io: socketIo.Socket | null = null;

    constructor(@inject('IServerConfigModel') serverConfiModel: IServerConfigModel) {
        this.serverConfiModel = serverConfiModel;
    }

    /**
     * SokcetIO 初期設定
     */
    public Iinitialize(): void {
        const config = this.serverConfiModel.getConfig();
        if (config === null || this.io !== null) {
            throw new Error('InitializationSocketIOError');
        }

        this.io = socketIo.io(`${location.protocol}//${location.hostname}:${config.socketIOPort}`, {
            path: `${Util.getSubDirectory()}/socket.io`,
        });
    }

    /**
     * 設定済み socketIO をのインスタを返す
     */
    public getIO(): socketIo.Socket | null {
        return this.io;
    }

    /**
     * update status イベントへのコールバック追加
     * @param callback: () => void
     */
    public onUpdateState(callback: () => void): void {
        if (this.io === null) {
            throw new Error('IOIsNull');
        }

        this.io.on(SocketIOModel.UPDATE_STATUS_EVENT, callback);
    }

    /**
     * update status イベントへのコールバック削除
     * @param callback: () => void
     */
    public offUpdateState(callback: () => void): void {
        if (this.io === null) {
            throw new Error('IOIsNull');
        }

        this.io.off(SocketIOModel.UPDATE_STATUS_EVENT, callback);
    }

    /**
     * EIT[p/f] 更新イベントへのコールバック追加。
     * 更新があった放送局 id が渡ってくるので、関係する画面だけが反応できる
     * @param callback: (payload: { channelIds: number[] }) => void
     */
    public onUpdateOnAirProgram(callback: (payload: { channelIds: number[] }) => void): void {
        if (this.io === null) {
            throw new Error('IOIsNull');
        }

        this.io.on(SocketIOModel.UPDATE_ON_AIR_PROGRAM_EVENT, callback);
    }

    /**
     * EIT[p/f] 更新イベントへのコールバック削除
     * @param callback: (payload: { channelIds: number[] }) => void
     */
    public offUpdateOnAirProgram(callback: (payload: { channelIds: number[] }) => void): void {
        if (this.io === null) {
            throw new Error('IOIsNull');
        }

        this.io.off(SocketIOModel.UPDATE_ON_AIR_PROGRAM_EVENT, callback);
    }

    /**
     * update encode status イベントへのコールバック追加
     * @param callback: () => void
     */
    public onUpdateEncodeState(callback: () => void): void {
        if (this.io === null) {
            throw new Error('IOIsNull');
        }

        this.io.on(SocketIOModel.UPDATE_ENCODE_STATUS_EVENT, callback);
    }

    /**
     * update encode status イベントへのコールバック削除
     * @param callback: () => void
     */
    public offUpdateEncodeState(callback: () => void): void {
        if (this.io === null) {
            throw new Error('IOIsNull');
        }

        this.io.off(SocketIOModel.UPDATE_ENCODE_STATUS_EVENT, callback);
    }
}

namespace SocketIOModel {
    export const UPDATE_STATUS_EVENT = 'updateStatus';
    export const UPDATE_ENCODE_STATUS_EVENT = 'updateEncode';
    export const UPDATE_ON_AIR_PROGRAM_EVENT = 'updateOnAirProgram';
}

export default SocketIOModel;
