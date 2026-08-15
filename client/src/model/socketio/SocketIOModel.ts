import { inject, injectable } from 'inversify';
import * as socketIo from 'socket.io-client';
import ApiMutationNotifier from '../../util/ApiMutationNotifier';
import Util from '../../util/Util';
import IServerConfigModel from '../serverConfig/IServerConfigModel';
import ISocketIOModel, { ProgramUpdatePayload } from './ISocketIOModel';

type SocketCallback = (...args: any[]) => void;

@injectable()
class SocketIOModel implements ISocketIOModel {
    private serverConfiModel: IServerConfigModel;
    private io: socketIo.Socket | null = null;

    // 接続先の候補。同じサーバーへ LAN 直アクセス・リバースプロキシ経由と
    // 複数の経路で繋がれるため、繋がらなければ順に試す
    private candidates: string[] = [];
    private candidateIndex: number = 0;
    private connectErrorCount: number = 0;

    // 接続先を切り替えても購読が失われないように、購読中のコールバックを自前で持つ
    private listeners: { [event: string]: SocketCallback[] } = {};
    private localNotifyTimer: ReturnType<typeof setTimeout> | null = null;

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

        this.candidates = this.createCandidates(config.socketIOPort, config.useDedicatedSocketIOPort === true);
        this.candidateIndex = 0;
        this.connect();

        // socket.io が使えない状況でも、自分の操作結果だけは画面へ反映されるようにする
        ApiMutationNotifier.addListener(this.onApiMutation);
    }

    /**
     * 接続先の候補を作る。
     *
     * socket.io が Web API と同じ待ち受けを共有している場合は、接続先を組み立てず
     * アクセス中のオリジンへそのまま接続する (リバースプロキシでポートが変換されていても繋がる)。
     * 専用ポートが指定されている場合は、そちらを先に試したうえで
     * アクセス中のオリジンへ退避できるようにしておく
     * @param socketIOPort: number サーバが返した socket.io のポート
     * @param useDedicatedSocketIOPort: boolean 専用ポートへ接続すべきか
     * @return string[]
     */
    private createCandidates(socketIOPort: number, useDedicatedSocketIOPort: boolean): string[] {
        const dedicatedUrl = `${location.protocol}//${location.hostname}:${socketIOPort}`;
        const candidates = useDedicatedSocketIOPort === true ? [dedicatedUrl, location.origin] : [location.origin, dedicatedUrl];

        // 同じ接続先が並ぶ場合 (専用ポート = アクセス中のポート) は 1 つにまとめる
        return candidates.filter((url, index) => candidates.indexOf(url) === index);
    }

    /**
     * 現在の候補へ接続する。
     * 購読済みのコールバックは新しい接続へ引き継ぐ
     */
    private connect(): void {
        const url = this.candidates[this.candidateIndex];
        this.io = socketIo.io(url, {
            path: `${Util.getSubDirectory()}/socket.io`,
            // 認証有効時に別オリジンへ接続する場合でもセッション Cookie を送る
            withCredentials: true,
        });

        // 購読中のコールバックを新しい接続へ張り直す
        for (const event in this.listeners) {
            for (const callback of this.listeners[event]) {
                this.io.on(event, callback);
            }
        }

        // 接続できていないことに気づけるようにしておく
        // (接続失敗は disconnect ではなく connect_error で通知される)
        this.io.on('connect_error', err => {
            console.error(`socket.io connect error: ${url}`, err);
            this.connectErrorCount++;
            this.switchCandidate();
        });

        this.io.on('connect', () => {
            this.connectErrorCount = 0;
        });
    }

    /**
     * 接続に失敗し続けている場合、次の接続先候補へ切り替える
     */
    private switchCandidate(): void {
        if (this.candidates.length <= 1 || this.connectErrorCount < SocketIOModel.SWITCH_THRESHOLD) {
            return;
        }

        this.connectErrorCount = 0;
        this.candidateIndex = (this.candidateIndex + 1) % this.candidates.length;

        if (this.io !== null) {
            // 古い接続が再接続を試み続けないように、こちらから閉じる
            this.io.removeAllListeners();
            this.io.close();
            this.io = null;
        }

        console.warn(`socket.io: switch endpoint to ${this.candidates[this.candidateIndex]}`);
        this.connect();
    }

    /**
     * 状態を変える API 呼び出しが成功したときの処理。
     * サーバからの通知と同じ扱いで購読中のコールバックを呼ぶ。
     * 連続した操作 (複数選択削除など) でまとめて再取得されるように少しだけ待つ
     */
    private onApiMutation = (): void => {
        if (this.localNotifyTimer !== null) {
            clearTimeout(this.localNotifyTimer);
        }

        this.localNotifyTimer = setTimeout(() => {
            this.localNotifyTimer = null;

            this.callLocalListeners(SocketIOModel.UPDATE_STATUS_EVENT);
            this.callLocalListeners(SocketIOModel.UPDATE_ENCODE_STATUS_EVENT);
        }, SocketIOModel.LOCAL_NOTIFY_DELAY);
    };

    /**
     * 指定したイベントの購読者を、サーバからの通知と同じ扱いで呼ぶ
     * @param event: string
     */
    private callLocalListeners(event: string): void {
        const callbacks = this.listeners[event];
        if (typeof callbacks === 'undefined') {
            return;
        }

        for (const callback of callbacks.concat()) {
            callback();
        }
    }

    /**
     * イベントの購読を開始する。
     * 接続先を切り替えたときに張り直せるよう、こちらでも保持しておく
     * @param event: string
     * @param callback: SocketCallback
     */
    private addListener(event: string, callback: SocketCallback): void {
        if (this.io === null) {
            throw new Error('IOIsNull');
        }

        if (typeof this.listeners[event] === 'undefined') {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
        this.io.on(event, callback);
    }

    /**
     * イベントの購読をやめる
     * @param event: string
     * @param callback: SocketCallback
     */
    private removeListener(event: string, callback: SocketCallback): void {
        if (this.io === null) {
            throw new Error('IOIsNull');
        }

        const callbacks = this.listeners[event];
        if (typeof callbacks !== 'undefined') {
            const index = callbacks.indexOf(callback);
            if (index !== -1) {
                callbacks.splice(index, 1);
            }
        }
        this.io.off(event, callback);
    }

    /**
     * 設定済み socketIO をのインスタを返す
     */
    public getIO(): socketIo.Socket | null {
        return this.io;
    }

    /**
     * サーバと繋がっているか
     * @return boolean
     */
    public isConnected(): boolean {
        return this.io !== null && this.io.connected === true;
    }

    /**
     * 接続イベントへのコールバック追加
     * @param callback: () => void
     */
    public onConnect(callback: () => void): void {
        this.addListener(SocketIOModel.CONNECT_EVENT, callback);
    }

    /**
     * 接続イベントへのコールバック削除
     * @param callback: () => void
     */
    public offConnect(callback: () => void): void {
        this.removeListener(SocketIOModel.CONNECT_EVENT, callback);
    }

    /**
     * 切断イベントへのコールバック追加
     * @param callback: () => void
     */
    public onDisconnect(callback: () => void): void {
        this.addListener(SocketIOModel.DISCONNECT_EVENT, callback);
    }

    /**
     * 切断イベントへのコールバック削除
     * @param callback: () => void
     */
    public offDisconnect(callback: () => void): void {
        this.removeListener(SocketIOModel.DISCONNECT_EVENT, callback);
    }

    /**
     * 接続失敗時のコールバック追加
     * @param callback: (err: Error) => void
     */
    public onConnectError(callback: (err: Error) => void): void {
        this.addListener(SocketIOModel.CONNECT_ERROR_EVENT, callback);
    }

    /**
     * 接続失敗時のコールバック削除
     * @param callback: (err: Error) => void
     */
    public offConnectError(callback: (err: Error) => void): void {
        this.removeListener(SocketIOModel.CONNECT_ERROR_EVENT, callback);
    }

    /**
     * update status イベントへのコールバック追加
     * @param callback: () => void
     */
    public onUpdateState(callback: () => void): void {
        this.addListener(SocketIOModel.UPDATE_STATUS_EVENT, callback);
    }

    /**
     * update status イベントへのコールバック削除
     * @param callback: () => void
     */
    public offUpdateState(callback: () => void): void {
        this.removeListener(SocketIOModel.UPDATE_STATUS_EVENT, callback);
    }

    /**
     * EIT[p/f] 更新イベントへのコールバック追加。
     * 更新があった放送局 id が渡ってくるので、関係する画面だけが反応できる
     * @param callback: (payload: { channelIds: number[] }) => void
     */
    public onUpdateOnAirProgram(callback: (payload: { channelIds: number[] }) => void): void {
        this.addListener(SocketIOModel.UPDATE_ON_AIR_PROGRAM_EVENT, callback);
    }

    /**
     * EIT[p/f] 更新イベントへのコールバック削除
     * @param callback: (payload: { channelIds: number[] }) => void
     */
    public offUpdateOnAirProgram(callback: (payload: { channelIds: number[] }) => void): void {
        this.removeListener(SocketIOModel.UPDATE_ON_AIR_PROGRAM_EVENT, callback);
    }

    /**
     * 番組情報更新イベントへのコールバック追加。
     * 変更のあった放送局 id と時間帯が渡ってくるので、
     * 番組表は表示中の時間帯と重なるときだけ取り直せる
     * @param callback: (payload: ProgramUpdatePayload) => void
     */
    public onUpdateProgram(callback: (payload: ProgramUpdatePayload) => void): void {
        this.addListener(SocketIOModel.UPDATE_PROGRAM_EVENT, callback);
    }

    /**
     * 番組情報更新イベントへのコールバック削除
     * @param callback: (payload: ProgramUpdatePayload) => void
     */
    public offUpdateProgram(callback: (payload: ProgramUpdatePayload) => void): void {
        this.removeListener(SocketIOModel.UPDATE_PROGRAM_EVENT, callback);
    }

    /**
     * update encode status イベントへのコールバック追加
     * @param callback: () => void
     */
    public onUpdateEncodeState(callback: () => void): void {
        this.addListener(SocketIOModel.UPDATE_ENCODE_STATUS_EVENT, callback);
    }

    /**
     * update encode status イベントへのコールバック削除
     * @param callback: () => void
     */
    public offUpdateEncodeState(callback: () => void): void {
        this.removeListener(SocketIOModel.UPDATE_ENCODE_STATUS_EVENT, callback);
    }
}

namespace SocketIOModel {
    export const CONNECT_EVENT = 'connect';
    export const DISCONNECT_EVENT = 'disconnect';
    export const CONNECT_ERROR_EVENT = 'connect_error';
    export const UPDATE_STATUS_EVENT = 'updateStatus';
    export const UPDATE_ENCODE_STATUS_EVENT = 'updateEncode';
    export const UPDATE_ON_AIR_PROGRAM_EVENT = 'updateOnAirProgram';
    export const UPDATE_PROGRAM_EVENT = 'updateProgram';
    // 連続した操作をまとめるための待ち時間 (ms)
    export const LOCAL_NOTIFY_DELAY = 300;
    // 接続先を切り替えるまでに許容する連続失敗回数
    export const SWITCH_THRESHOLD = 2;
}

export default SocketIOModel;
