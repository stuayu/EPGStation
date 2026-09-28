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
import { formatLogTimeRange } from '../../../util/ProgramTimeLog';
import ISocketIOManageModel from './ISocketIOManageModel';

@injectable()
export default class SocketIOManageModel implements ISocketIOManageModel {
    // EIT[p/f] 相当の更新通知に使う socket.io イベント名 (クライアントと合わせること)
    private static readonly ON_AIR_PROGRAM_EVENT = 'updateOnAirProgram';
    // 番組情報の更新通知に使う socket.io イベント名 (クライアントと合わせること)
    private static readonly PROGRAM_UPDATED_EVENT = 'updateProgram';

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
                        // クライアントは認証セッションの Cookie を送るため、
                        // `*` ではなく要求元をそのまま許可する
                        // (`Access-Control-Allow-Origin: *` は credentials 付きの要求では拒否されるため)
                        origin: true,
                        credentials: true,
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
                    const token = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE_NAME);
                    authModel
                        .verify(token)
                        .then(payload => {
                            if (payload !== null) socket.data.userId = payload.uid;
                            next();
                        })
                        .catch(() => next());

                    return;
                }
                const token = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE_NAME);
                authModel
                    .verify(token)
                    .then(payload => {
                        if (payload !== null) socket.data.userId = payload.uid;
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

        // 画面が追従しているかを追えるように、配った内容と接続数を残す
        this.log.system.info(
            `notify ${SocketIOManageModel.ON_AIR_PROGRAM_EVENT}: channels: [${channelIds.join(', ')}] clients: ${this.getClientCount()}`,
        );
    }

    /**
     * 番組情報の更新を通知する。
     * EIT[p/f] の窓 (現在〜10 分先) の外で起きた変更も含むため、
     * 受け取った側は表示している時間帯と重なるときだけ反応する
     * @param option: { channelIds: number[]; startAt: number | null; endAt: number | null }
     */
    public notifyProgramUpdated(option: { channelIds: number[]; startAt: number | null; endAt: number | null }): void {
        if (this.ios.length === 0) {
            throw new Error('must call SocketIoManageModel initialize');
        }

        for (const io of this.ios) {
            io.sockets.emit(SocketIOManageModel.PROGRAM_UPDATED_EVENT, option);
        }

        this.log.system.info(
            `notify ${SocketIOManageModel.PROGRAM_UPDATED_EVENT}: channels: [${option.channelIds.join(', ')}] ` +
                `range: ${formatLogTimeRange(option.startAt, option.endAt)} clients: ${this.getClientCount()}`,
        );
    }

    /** 番組開始前リマインダーを接続中のクライアントへ送る */
    public notifyProgramStarting(
        payload: { programId: number; channelId: number; name: string; startAt: number; minutesBefore: number },
        userId: number | null,
        notificationTargetCount: number,
    ): void {
        let deliveredClientCount = 0;
        for (const io of this.ios) {
            if (userId === null) {
                deliveredClientCount += io.sockets.sockets.size;
                io.sockets.emit('programStarting', payload);
            } else
                for (const socket of io.sockets.sockets.values()) {
                    if (socket.data.userId === userId) {
                        deliveredClientCount++;
                        socket.emit('programStarting', payload);
                    }
                }
        }
        this.log.system.info(
            `program reminder fired: programId: ${payload.programId} name: ${payload.name} ` +
                `minutesBefore: ${payload.minutesBefore} notificationTargets: ${notificationTargetCount} ` +
                `socketClients: ${deliveredClientCount}`,
        );
    }

    /**
     * socket.io に接続中のクライアント数を返す
     * @return number
     */
    private getClientCount(): number {
        let count = 0;
        for (const io of this.ios) {
            count += io.sockets.sockets.size;
        }

        return count;
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

    public notifyPowerSuspending(value: { action: string; executeAt: number }): void {
        for (const io of this.ios) io.sockets.emit('powerSuspending', value);
    }
}
