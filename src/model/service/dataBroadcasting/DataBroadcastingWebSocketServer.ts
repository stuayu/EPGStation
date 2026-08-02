import * as http from 'http';
import { inject, injectable } from 'inversify';
import type internal from 'stream';
import urljoin from 'url-join';
import { WebSocketServer } from 'ws';
import type WebSocket from 'ws';
import IAuthModel from '../../auth/IAuthModel';
import { SESSION_COOKIE_NAME } from '../../auth/SessionCookie';
import { readCookie } from '../../auth/SessionToken';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import { parseDataBroadcastingParam } from './DataBroadcastingParamParser';
import IDataBroadcastingManageModel from './IDataBroadcastingManageModel';
import IDataBroadcastingWebSocketServer from './IDataBroadcastingWebSocketServer';

@injectable()
export default class DataBroadcastingWebSocketServer implements IDataBroadcastingWebSocketServer {
    // WebSocket ハンドシェイク完了後、パラメータが不正だった場合に使う close code
    private static readonly INVALID_PARAM_CLOSE_CODE = 1008;

    private log: ILogger;
    private config: IConfigFile;
    private authModel: IAuthModel;
    private manageModel: IDataBroadcastingManageModel;
    private wss: WebSocketServer;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IAuthModel') authModel: IAuthModel,
        @inject('IDataBroadcastingManageModel') manageModel: IDataBroadcastingManageModel,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.authModel = authModel;
        this.manageModel = manageModel;
        this.wss = new WebSocketServer({ noServer: true });
    }

    /**
     * 渡された http/https サーバーの 'upgrade' イベントを監視し、
     * データ放送用 WebSocket のパスに一致するリクエストだけを処理する。
     * socket.io と同じサーバーに同居するため、パスが一致しないリクエストの socket には一切触れない
     * @param servers: http.Server[]
     */
    public initialize(servers: http.Server[]): void {
        const wsPath = this.createUrl('/api/dataBroadcasting/ws');

        for (const server of servers) {
            server.on('upgrade', (req: http.IncomingMessage, socket: internal.Duplex, head: Buffer) => {
                this.handleUpgrade(req, socket, head, wsPath);
            });
        }

        this.log.system.info('DataBroadcastingWebSocketServer has started.');
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

        // パスが一致しないリクエストには一切触れない (socket.io のハンドシェイクを壊さないため)
        if (pathname !== wsPath) {
            return;
        }

        if (isFeatureEnabled(this.config, 'dataBroadcasting') === false) {
            socket.destroy();

            return;
        }

        this.authorize(req)
            .then(authorized => {
                if (authorized === false) {
                    this.rejectWithHttpStatus(socket, 401, 'Unauthorized');

                    return;
                }

                this.wss.handleUpgrade(req, socket as any, head, ws => {
                    this.onConnection(ws, req);
                });
            })
            .catch(err => {
                this.log.system.error(err);
                socket.destroy();
            });
    }

    /**
     * config.yml の auth.enabled が true の場合のみセッション Cookie を検証する。
     * SocketIOManageModel と同じ方式 (匿名許可設定も踏襲する)
     * @param req: http.IncomingMessage
     * @return Promise<boolean> true なら接続を許可する
     */
    private async authorize(req: http.IncomingMessage): Promise<boolean> {
        if (this.authModel.isEnabled() === false) {
            return true;
        }

        if (this.authModel.isAnonymousAllowed() === true) {
            return true;
        }

        const token = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
        const payload = await this.authModel.verify(token);

        return payload !== null;
    }

    /**
     * WebSocket ハンドシェイクが完了したときの処理。
     * クエリの param を検証し、不正なら 1008 で切断する
     */
    private onConnection(ws: WebSocket, req: http.IncomingMessage): void {
        const param = parseDataBroadcastingParam(req.url);
        if (param === null) {
            ws.close(DataBroadcastingWebSocketServer.INVALID_PARAM_CLOSE_CODE, 'invalid parameters');

            return;
        }

        this.manageModel.start(ws, param).catch(err => {
            this.log.system.error(err);
            ws.close(1011);
        });
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
