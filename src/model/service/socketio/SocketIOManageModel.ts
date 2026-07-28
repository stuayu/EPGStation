import * as http from 'http';
import { inject, injectable } from 'inversify';
import * as SocketIO from 'socket.io';
import urljoin from 'url-join';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IAuthModel from '../../auth/IAuthModel';
import { SESSION_COOKIE_NAME } from '../../auth/SessionCookie';
import { readCookie } from '../../auth/SessionToken';
import container from '../../ModelContainer';
import ISocketIOManageModel from './ISocketIOManageModel';

@injectable()
export default class SocketIOManageModel implements ISocketIOManageModel {
    // EIT[p/f] 相当の更新通知に使う socket.io イベント名 (クライアントと合わせること)
    private static readonly ON_AIR_PROGRAM_EVENT = 'updateOnAirProgram';

    private log: ILogger;
    private config: IConfigFile;
    private ios: SocketIO.Server[] = [];
    private callTimer: ReturnType<typeof setTimeout> | null = null;
    private encodeProgressCallTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(@inject('ILoggerModel') logger: ILoggerModel, @inject('IConfiguration') configuration: IConfiguration) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
    }

    /**
     * socket.io 初期化
     * @param servers: http.Server[]
     */
    public initialize(servers: http.Server[]): void {
        for (const s of servers) {
            this.ios.push(
                new SocketIO.Server(s, {
                    path:
                        typeof this.config.subDirectory === 'undefined'
                            ? '/socket.io'
                            : urljoin(this.config.subDirectory, '/socket.io'),
                    cors: {
                        origin: '*',
                    },
                }),
            );
        }

        // 認証有効時は、未ログインのクライアントから接続 (通知の受信) をできなくする
        const authModel = container.get<IAuthModel>('IAuthModel');
        for (const io of this.ios) {
            io.use((socket, next) => {
                if (authModel.isEnabled() === false) {
                    next();

                    return;
                }
                // 未ログインでも一般ユーザーと同じ操作を許可する設定なら通知も受け取れるようにする
                if (authModel.isAnonymousAllowed() === true) {
                    next();

                    return;
                }
                const token = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE_NAME);
                authModel
                    .verify(token)
                    .then(payload => {
                        next(payload === null ? new Error('Unauthorized') : undefined);
                    })
                    .catch(err => {
                        this.log.system.error(err);
                        next(new Error('Unauthorized'));
                    });
            });
        }

        this.log.system.info('SocketIO Server has started.');
    }

    /**
     * client へ状態変更通知
     */
    public notifyClient(): void {
        if (this.callTimer === null) {
            this.callTimer = setTimeout(() => {
                this.callTimer = null;

                if (this.ios.length === 0) {
                    throw new Error('must call SocketIoManageModel initialize');
                }

                for (const io of this.ios) {
                    io.sockets.emit('updateStatus');
                }
            }, 200);
        }
    }

    /**
     * EIT[p/f] 相当の更新を通知する。
     * 10 秒周期で来る可能性があるため、全体更新 (updateStatus) とは別イベントにして
     * 視聴画面・番組表など関係する画面だけが反応できるようにする
     * @param channelIds: number[]
     */
    public notifyOnAirProgramUpdated(channelIds: number[]): void {
        if (this.ios.length === 0) {
            throw new Error('must call SocketIoManageModel initialize');
        }

        for (const io of this.ios) {
            io.sockets.emit(SocketIOManageModel.ON_AIR_PROGRAM_EVENT, { channelIds });
        }
    }

    /**
     * エンコードの進捗情報更新を通知
     */
    public notifyUpdateEncodeProgress(): void {
        if (this.encodeProgressCallTimer === null) {
            this.encodeProgressCallTimer = setTimeout(() => {
                this.encodeProgressCallTimer = null;

                if (this.ios.length === 0) {
                    throw new Error('must call SocketIoManageModel initialize');
                }

                for (const io of this.ios) {
                    io.sockets.emit('updateEncode');
                }
            }, 200);
        }
    }
}
