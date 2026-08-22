import * as http from 'http';
import { inject, injectable } from 'inversify';
import type internal from 'stream';
import urljoin from 'url-join';
import { WebSocketServer } from 'ws';
import IAuthModel from '../../auth/IAuthModel';
import { SESSION_COOKIE_NAME } from '../../auth/SessionCookie';
import { readCookie } from '../../auth/SessionToken';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import ISnsTimelineRelayManageModel from './ISnsTimelineRelayManageModel';
import ISnsTimelineWebSocketServer from './ISnsTimelineWebSocketServer';

/**
 * Misskey リアルタイムタイムラインをクライアントへ中継する WebSocket のエントリーポイント。
 * 既存の socket.io / データ放送用 WebSocket (`DataBroadcastingWebSocketServer`) と同じ流儀で、
 * 同じサーバーの 'upgrade' イベントに `noServer: true` で相乗りする。
 * パスが一致しないリクエストの socket には一切触れない (触ると他の WebSocket のハンドシェイクが壊れる)
 */
@injectable()
export default class SnsTimelineWebSocketServer implements ISnsTimelineWebSocketServer {
    private log: ILogger;
    private config: IConfigFile;
    private authModel: IAuthModel;
    private relayManageModel: ISnsTimelineRelayManageModel;
    private wss: WebSocketServer;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IAuthModel') authModel: IAuthModel,
        @inject('ISnsTimelineRelayManageModel') relayManageModel: ISnsTimelineRelayManageModel,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.authModel = authModel;
        this.relayManageModel = relayManageModel;
        this.wss = new WebSocketServer({ noServer: true });
    }

    /**
     * 渡された http/https サーバーの 'upgrade' イベントを監視し、
     * SNS タイムライン中継用 WebSocket のパスに一致するリクエストだけを処理する
     * @param servers: http.Server[]
     */
    public initialize(servers: http.Server[]): void {
        const wsPath = this.createUrl('/api/sns/ws');

        for (const server of servers) {
            server.on('upgrade', (req: http.IncomingMessage, socket: internal.Duplex, head: Buffer) => {
                this.handleUpgrade(req, socket, head, wsPath);
            });
        }

        this.log.system.info('SnsTimelineWebSocketServer has started.');
    }

    /**
     * upgrade イベントのハンドラ
     */
    private handleUpgrade(req: http.IncomingMessage, socket: internal.Duplex, head: Buffer, wsPath: string): void {
        let pathname: string;
        try {
            pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        } catch (err) {
            // このリクエストの解釈は関知しない (他のハンドラに委ねる)
            return;
        }

        // パスが一致しないリクエストには一切触れない (socket.io / データ放送のハンドシェイクを壊さないため)
        if (pathname !== wsPath) {
            return;
        }

        this.resolveAccess(req)
            .then(({ authorized, userId }) => {
                if (authorized === false) {
                    this.rejectWithHttpStatus(socket, 401, 'Unauthorized');

                    return;
                }

                this.wss.handleUpgrade(req, socket as any, head, ws => {
                    this.relayManageModel.start(ws, userId);
                });
            })
            .catch(err => {
                this.log.system.error(err);
                socket.destroy();
            });
    }

    /**
     * config.yml の auth.enabled が true の場合のみセッション Cookie を検証し、
     * 接続を許可するか (authorized) とログインユーザー id (userId) を求める。
     * userId は各アカウントの所有者確認 (他人の TL を覗けないようにする) に使う
     * @param req: http.IncomingMessage
     * @return Promise<{ authorized: boolean; userId: number | null }>
     */
    private async resolveAccess(req: http.IncomingMessage): Promise<{ authorized: boolean; userId: number | null }> {
        if (this.authModel.isEnabled() === false) {
            return { authorized: true, userId: null };
        }

        const token = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
        const payload = await this.authModel.verify(token);
        const userId = payload?.uid ?? null;

        if (payload === null && this.authModel.isAnonymousAllowed() === false) {
            return { authorized: false, userId: null };
        }

        return { authorized: true, userId };
    }

    /**
     * WebSocket ハンドシェイク前に HTTP ステータスを返して socket を破棄する
     */
    private rejectWithHttpStatus(socket: internal.Duplex, statusCode: number, message: string): void {
        try {
            socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\n\r\n`);
        } catch (err) {
            // 書き込み失敗は無視して destroy に進む
        }
        socket.destroy();
    }

    /**
     * サブディレクトリを付加した path を返す
     * @param urlStr: string
     */
    private createUrl(urlStr: string): string {
        return typeof this.config.subDirectory === 'undefined' ? urlStr : urljoin(this.config.subDirectory, urlStr);
    }
}
