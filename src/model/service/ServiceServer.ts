import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import * as openapi from 'express-openapi';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { inject, injectable } from 'inversify';
import * as yaml from 'js-yaml';
import * as log4js from 'log4js';
import { mkdirp } from 'mkdirp';
import multer from 'multer';
import { OpenAPIV3 } from 'openapi-types';
import * as path from 'path';
import type { ServeStaticOptions } from 'serve-static';
import urljoin from 'url-join';
import FileUtil from '../../util/FileUtil';
import IAuthModel from '../auth/IAuthModel';
import { isAdminApiPath, isMediaApiPath, isPublicApiPath, toApiPath } from '../auth/AuthGuard';
import { SESSION_COOKIE_NAME } from '../auth/SessionCookie';
import { readCookie } from '../auth/SessionToken';
import container from '../ModelContainer';
import IConfigFile from '../IConfigFile';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IVideoApiModel from '../api/video/IVideoApiModel';
import IDataBroadcastingWebSocketServer from './dataBroadcasting/IDataBroadcastingWebSocketServer';
import IServiceServer from './IServiceServer';
import ISocketIOManageModel from './socketio/ISocketIOManageModel';
import IHLSMemoryStoreModel from './stream/util/IHLSMemoryStoreModel';

const swaggerdist = require('swagger-ui-dist');

interface PackageMetadata {
    name: string;
    version: string;
}

const isPackageMetadata = (value: unknown): value is PackageMetadata => {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as Record<string, unknown>).name === 'string' &&
        typeof (value as Record<string, unknown>).version === 'string'
    );
};

@injectable()
class ServiceServer implements IServiceServer {
    // 起動時のメタデータ一括解析の 1 回あたりの件数
    private static readonly VIDEO_METADATA_ANALYZE_CHUNK = 20;

    private log: ILogger;
    private config: IConfigFile;
    private socketIoManageModel: ISocketIOManageModel;
    private hlsMemoryStore: IHLSMemoryStoreModel;
    private dataBroadcastingWebSocketServer: IDataBroadcastingWebSocketServer;
    private app = express();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('ISocketIOManageModel')
        socketIoManageModel: ISocketIOManageModel,
        @inject('IHLSMemoryStoreModel') hlsMemoryStore: IHLSMemoryStoreModel,
        @inject('IDataBroadcastingWebSocketServer') dataBroadcastingWebSocketServer: IDataBroadcastingWebSocketServer,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.socketIoManageModel = socketIoManageModel;
        this.hlsMemoryStore = hlsMemoryStore;
        this.dataBroadcastingWebSocketServer = dataBroadcastingWebSocketServer;

        this.init();
    }

    /**
     * 初期化処理
     */
    private init(): void {
        this.setLog();
        const api = this.getApiDocument(ServiceServer.API_YML);
        if (this.config.isAllowAllCORS === true) {
            this.app.use(cors());
        }
        this.setSwaggerUI();
        this.createUploadDir();
        this.setAuthGuard();
        this.initOpenApi(api);
        this.setStaticFiles();
    }

    /**
     * 認証ガードの設定。
     * config.yml で auth.enabled が true のときだけ有効になり、
     * API・サムネイル・配信ファイルへの未認証アクセスを 401 で弾く。
     * クライアントの静的ファイルはログイン画面を表示するために素通しする
     */
    private setAuthGuard(): void {
        const authModel = container.get<IAuthModel>('IAuthModel');
        const apiBase = this.createUrl('/api');
        const protectedPrefixes = [this.createUrl('/thumbnail'), this.createUrl('/streamfiles')];

        this.app.use(async (req, res, next) => {
            if (authModel.isEnabled() === false) {
                next();

                return;
            }

            const apiPath = toApiPath(req.url, apiBase);
            const isProtectedFile = protectedPrefixes.some(
                prefix => req.url === prefix || req.url.startsWith(`${prefix}/`),
            );
            // API でもサムネイル/配信でもない = クライアントの静的ファイルなので認証不要
            if (apiPath === null && isProtectedFile === false) {
                next();

                return;
            }
            if (apiPath !== null && isPublicApiPath(apiPath) === true) {
                next();

                return;
            }

            try {
                const token = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
                let payload = await authModel.verify(token);

                // 外部プレイヤー・IPTV クライアントは Cookie を送れないため、
                // 動画配信系に限りクエリのアクセストークンでも認証を通す
                if (payload === null && apiPath !== null && isMediaApiPath(apiPath) === true) {
                    const query = new URL(req.url, 'http://localhost').searchParams.get('token');
                    payload = await authModel.verifyMediaToken(query);
                }

                const isAdminRequest = apiPath !== null && isAdminApiPath(apiPath) === true;

                if (payload === null) {
                    // 未ログインでも一般ユーザーと同じ操作を許可する設定なら、
                    // システム管理者向け以外はそのまま通す
                    if (authModel.isAnonymousAllowed() === true && isAdminRequest === false) {
                        next();

                        return;
                    }

                    res.status(401).json({ code: 401, message: 'Unauthorized' });

                    return;
                }
                // システム全体に影響する API はシステム管理者だけに許す
                if (isAdminRequest === true && payload.role !== 'admin') {
                    res.status(403).json({ code: 403, message: 'Forbidden' });

                    return;
                }
            } catch (err) {
                this.log.system.error(err);
                res.status(500).json({ code: 500, message: 'AuthCheckFailed' });

                return;
            }
            next();
        });
    }

    /**
     * log の設定
     */
    private setLog(): void {
        this.app.use(log4js.connectLogger(this.log.access, { level: 'info' }));
    }

    /**
     * api.yml の読み込み
     * @param ymlPath: api.yml のファイルパス
     * @return OpenAPIV3.Document
     */
    private getApiDocument(ymlPath: string): OpenAPIV3.Document {
        const api = <OpenAPIV3.Document>yaml.load(fs.readFileSync(ymlPath, 'utf-8'));

        // host 設定
        api.servers = this.config.apiServers.map(url => {
            return {
                url: urljoin(url, this.createUrl('/api')),
            };
        });

        // set title and version
        const packageJson: unknown = JSON.parse(fs.readFileSync(ServiceServer.PACKAGE_JSON, 'utf-8'));
        if (!isPackageMetadata(packageJson)) {
            throw new Error('InvalidPackageMetadata');
        }
        api.info.title = packageJson.name;
        api.info.version = packageJson.version;

        return api;
    }

    /**
     * Open Api 設定
     * @param api: OpenAPIV3.Document
     */
    private initOpenApi(api: OpenAPIV3.Document): void {
        // Express 5 では req.query がアクセスごとに再パースされる getter となり、
        // express-openapi の型変換 (coercion) 結果が保持されないため、自前プロパティとして実体化する
        this.app.use((req, _res, next) => {
            const query = req.query;
            Object.defineProperty(req, 'query', {
                value: query,
                writable: true,
                enumerable: true,
                configurable: true,
            });
            next();
        });

        openapi.initialize({
            apiDoc: api,
            app: this.app,
            docsPath: '/docs',
            consumesMiddleware: {
                'application/json': express.json(),
                'text/text': express.text(),
                'multipart/form-data': (req, res, next) => {
                    this.uploadFile(req, res, next);
                },
            },
            errorMiddleware: (err, _req, res, _next) => {
                this.log.system.error(err);
                res.status(400);
                res.json(err);
            },
            errorTransformer: openApi => {
                this.log.system.error(openApi);
                const message =
                    typeof openApi === 'object' && openApi !== null && 'message' in openApi
                        ? String(openApi.message)
                        : 'OpenAPI validation error';

                return { message };
            },
            exposeApiDocs: true,
            paths: ServiceServer.API_DIR,
        });
    }

    /**
     * ファイル読み込み url 設定
     */
    private setStaticFiles(): void {
        // static files
        this.app.use(
            this.createUrl('/img'),
            express.static(path.join(__dirname, '..', '..', '..', 'img'), this.getStaticOptions()),
        );

        // thumbnail
        this.app.use(this.createUrl('/thumbnail'), express.static(this.config.thumbnail, this.getStaticOptions()));

        // in-memory HLS (ディスクに書き出さないライブ HLS 配信)
        // メモリストアに存在しないファイルは next() で従来のディスク配信 (express.static) へフォールバックする
        this.app.get(this.createUrl('/streamfiles/:filename'), (req, res, next) => {
            this.serveInMemoryHLSFile(req, res, next);
        });

        // streamFile
        this.app.use(
            this.createUrl('/streamfiles'),
            express.static(this.config.streamFilePath, this.getStaticOptions()),
        );

        // client
        this.app.use(this.createUrl('/'), express.static(ServiceServer.CLIENT_DIR, this.getStaticOptions()));
    }

    /**
     * in-memory HLS のプレイリスト・セグメント配信
     * メモリストアに存在しない場合は next() を呼び、従来のディスク配信へフォールバックする
     */
    private serveInMemoryHLSFile(req: Request, res: Response, next: NextFunction): void {
        const filename = req.params.filename;
        if (typeof filename !== 'string') {
            next();

            return;
        }

        // プレイリスト: stream{id}.m3u8
        const playlistMatch = /^stream(\d+)\.m3u8$/.exec(filename);
        if (playlistMatch !== null) {
            const streamId = parseInt(playlistMatch[1], 10);
            if (this.hlsMemoryStore.has(streamId) === false) {
                next();

                return;
            }

            const playlist = this.hlsMemoryStore.getPlaylist(streamId);
            if (playlist === null) {
                // ストリームは存在するがまだセグメントが揃っていない
                res.status(404).end();

                return;
            }

            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Cache-Control', 'no-store');
            res.status(200).send(playlist);

            return;
        }

        // init セグメント: stream{id}-init.mp4
        const initMatch = /^stream(\d+)-init\.mp4$/.exec(filename);
        if (initMatch !== null) {
            const data = this.hlsMemoryStore.getInitSegment(parseInt(initMatch[1], 10));
            if (data === null) {
                next();

                return;
            }

            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Cache-Control', 'no-store');
            res.status(200).send(data);

            return;
        }

        // メディアセグメント: stream{id}-{seq}.m4s
        const segmentMatch = /^stream(\d+)-(\d+)\.m4s$/.exec(filename);
        if (segmentMatch !== null) {
            const streamId = parseInt(segmentMatch[1], 10);
            if (this.hlsMemoryStore.has(streamId) === false) {
                next();

                return;
            }

            const data = this.hlsMemoryStore.getSegment(streamId, parseInt(segmentMatch[2], 10));
            if (data === null) {
                // 破棄済み or 未生成のセグメント
                res.status(404).end();

                return;
            }

            res.setHeader('Content-Type', 'video/iso.segment');
            res.setHeader('Cache-Control', 'no-store');
            res.status(200).send(data);

            return;
        }

        next();
    }

    /** Express 5 で必要な配信ファイルの MIME を明示する。 */
    private getStaticOptions(): ServeStaticOptions {
        return {
            setHeaders: (res, filePath): void => {
                const mimeByExtension: Record<string, string> = {
                    '.ts': 'video/mp2t',
                    '.m4s': 'video/iso.segment',
                    '.m3u8': 'application/vnd.apple.mpegurl',
                    '.log': 'text/plain; charset=utf-8',
                };
                const mime = mimeByExtension[path.extname(filePath).toLowerCase()];
                if (typeof mime !== 'undefined') {
                    res.setHeader('Content-Type', mime);
                }
            },
        };
    }

    /**
     * SwaggerUI の設定
     */
    private setSwaggerUI(): void {
        if (fs.existsSync(ServiceServer.SWAGGER_UI_DIST) === false) {
            return;
        }

        // replace url
        // issue: https://github.com/swagger-api/swagger-ui/issues/5710
        const pathToSwaggerUi: string = swaggerdist.getAbsoluteFSPath();
        const indexContent = fs
            .readFileSync(path.join(pathToSwaggerUi, 'swagger-initializer.js'))
            .toString()
            .replace('https://petstore.swagger.io/v2/swagger.json', this.createUrl('/api/docs'));

        this.app.get(this.createUrl('/api-docs/swagger-initializer.js'), (_req, res) => {
            res.send(indexContent);
        });

        // api doc
        this.app.use(this.createUrl('/api-docs'), express.static(ServiceServer.SWAGGER_UI_DIST));

        // リダイレクト設定
        this.app.get(this.createUrl('/api/debug'), (_req, res) => {
            return res.redirect(this.createUrl('/api-docs/?url=' + this.createUrl('/api/docs')));
        });
    }

    /**
     * upload 用のディレクトリを生成する
     */
    private createUploadDir(): void {
        // upload dir
        try {
            fs.statSync(this.config.uploadTempDir);
        } catch (e: any) {
            this.log.system.info(`mkdirp: ${this.config.uploadTempDir}`);
            mkdirp.sync(this.config.uploadTempDir);
        }
    }

    /**
     * ファイルを upload する
     * @param req
     * @param res
     * @param next
     */
    private uploadFile(req: Request, res: Response, next: NextFunction): void {
        // uploade 生成
        let fileName = '';
        const storage = multer.diskStorage({
            destination: this.config.uploadTempDir,
            filename: (_req, file, cb) => {
                fileName =
                    file.fieldname +
                    '-' +
                    new Date().getTime().toString(16) +
                    Math.floor(100000 * Math.random()).toString(16);
                cb(null, fileName);
            },
        });

        multer({ storage: storage }).single('file')(req, res, async (err: unknown) => {
            if (err) {
                // エラー時はファイルを削除
                const filePath = path.join(this.config.uploadTempDir, fileName);
                try {
                    await FileUtil.unlink(filePath);
                    this.log.access.info(`delete upload file: ${filePath}`);
                } catch (err: any) {
                    this.log.access.error(`upload file delete error: ${filePath}`);
                    this.log.access.error(err.message);
                }
                return next(err instanceof Error ? err : new Error(String(err)));
            }

            // multipart/form-data では数値も文字列で届く。
            // 空文字や数値として解釈できない値を parseInt すると NaN になり、
            // OpenAPI の integer 検証で 400 になってしまう
            // (recordedId 省略時の「TS を解析して番組情報を自動作成する」経路が使えなくなる) ため、
            // 「未指定」としてキーごと削除する
            if (typeof req.body.recordedId === 'string') {
                const parsedRecordedId = parseInt(req.body.recordedId, 10);
                if (req.body.recordedId.trim().length === 0 || Number.isNaN(parsedRecordedId) === true) {
                    delete req.body.recordedId;
                } else {
                    req.body.recordedId = parsedRecordedId;
                }
            }

            // 空文字で届いた任意項目は「未指定」として扱う。
            // 特に localFilePath は空文字のままだと「サーバー上のファイル指定」とみなされ、
            // importDirs の検証に入って ImportDirsNotConfigured で失敗してしまう
            for (const optionalKey of ['localFilePath', 'subDirectory']) {
                if (typeof req.body[optionalKey] === 'string' && req.body[optionalKey].trim().length === 0) {
                    delete req.body[optionalKey];
                }
            }

            if (typeof req.file !== 'undefined' && typeof req.file.fieldname !== 'undefined') {
                req.body.file = req.file.filename;
            }

            return next();
        });
    }

    /**
     * サブディレクトリを付加した path を返す
     * @param url: string
     */
    private createUrl(urlStr: string): string {
        return typeof this.config.subDirectory === 'undefined' ? urlStr : urljoin(this.config.subDirectory, urlStr);
    }

    /**
     * 未解析の録画ファイルメタデータをバックグラウンドで順次解析する
     * @return Promise<void>
     */
    private async analyzeVideoFileMetadata(): Promise<void> {
        const videoApiModel = container.get<IVideoApiModel>('IVideoApiModel');

        try {
            const status = await videoApiModel.getMetadataStatus();
            if (status.unanalyzed === 0) {
                return;
            }
            this.log.system.info(`start video file metadata analysis: ${status.unanalyzed} files`);

            let analyzed = 0;
            let failed = 0;
            for (;;) {
                const result = await videoApiModel.analyzeAllMetadata(ServiceServer.VIDEO_METADATA_ANALYZE_CHUNK);
                analyzed += result.analyzed;
                failed += result.failed;

                // これ以上進まない (全件失敗 or 対象なし) 場合は打ち切る
                if (result.analyzed === 0 || result.remaining === 0) {
                    break;
                }
            }

            this.log.system.info(`video file metadata analysis done: analyzed ${analyzed}, failed ${failed}`);
        } catch (err: any) {
            this.log.system.error('video file metadata analysis error');
            this.log.system.error(err);
        }
    }

    /**
     * http server 起動
     */
    public start(): void {
        // 過去の録画ファイルのメタデータをバックグラウンドで埋める
        void this.analyzeVideoFileMetadata();

        const sokcetioServers: http.Server[] = [];
        // Web API (express アプリ) を実際に配信しているサーバー。
        // データ放送用 WebSocket はこの上で upgrade を待ち受ける (socket.io 専用ポートとは別枠で管理する)
        const appServers: http.Server[] = [];

        // http
        if (typeof this.config.port !== 'undefined') {
            const socketioPort =
                typeof this.config.socketioPort !== 'undefined' ? this.config.socketioPort : this.config.port;

            const server = this.app.listen(this.config.port, () => {
                this.log.system.info(`http server listening on ${this.config.port}`);
            });
            appServers.push(server);

            // socket.io
            if (socketioPort === this.config.port) {
                sokcetioServers.push(server);
            } else {
                const socketIOServer = http.createServer();
                socketIOServer.listen(this.config.socketioPort, () => {
                    this.log.system.info(`http SocketIO listening on ${this.config.socketioPort}`);
                });

                sokcetioServers.push(socketIOServer);
            }
        }

        // https
        if (typeof this.config.https !== 'undefined') {
            const option: https.ServerOptions = {
                key: fs.readFileSync(this.config.https.key),
                cert: fs.readFileSync(this.config.https.cert),
            };
            if (typeof this.config.https.ca !== 'undefined') {
                if (typeof this.config.https.ca === 'string') {
                    option.ca = fs.readFileSync(this.config.https.ca);
                } else {
                    option.ca = this.config.https.ca.map(f => {
                        return fs.readFileSync(f);
                    });
                }
                option.requestCert = true;
                option.rejectUnauthorized = true;
            }

            const httpsServer = https.createServer(option, this.app);
            httpsServer.listen(this.config.https.port, () => {
                if (typeof this.config.https !== 'undefined') {
                    this.log.system.info(`https server listening on ${this.config.https.port}`);
                }
            });
            appServers.push(httpsServer);

            // socket.io
            if (typeof this.config.https.socketioPort === 'undefined') {
                sokcetioServers.push(httpsServer);
            } else {
                const socketIOServer = https.createServer(option);
                sokcetioServers.push(socketIOServer);
                socketIOServer.listen(this.config.https.socketioPort, () => {
                    this.log.system.info(`https SocketIO listening on ${this.config.socketioPort}`);
                });
            }
        }

        this.socketIoManageModel.initialize(sokcetioServers);
        this.dataBroadcastingWebSocketServer.initialize(appServers);
    }
}

namespace ServiceServer {
    export const ROOT_DIR = path.join(__dirname, '..', '..', '..');
    export const API_YML = path.join(ServiceServer.ROOT_DIR, 'api.yml');
    export const PACKAGE_JSON = path.join(ServiceServer.ROOT_DIR, 'package.json');
    export const SWAGGER_UI_DIST = path.join(ServiceServer.ROOT_DIR, 'node_modules', 'swagger-ui-dist');
    export const API_DIR = path.join(__dirname, 'api');
    export const CLIENT_DIR = path.join(ROOT_DIR, 'client', 'dist');
}

export default ServiceServer;
