import { inject, injectable } from 'inversify';
import * as path from 'path';
import FileUtil from '../../util/FileUtil';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IConfiguration from '../IConfiguration';
import IProviderHttpClient from './IProviderHttpClient';
import ISharedDataFetcher, { SharedMetadataPayload } from './ISharedDataFetcher';

/**
 * チャンネルマッピング表・エイリアス辞書等の共有静的データを GitHub 等から自動取得する (§5.1)。
 * - 起動時 + 設定された間隔で `metadataSharedDataUrl` から JSON を取得しローカルへキャッシュする
 * - オフライン・取得失敗時は前回のローカルキャッシュへフォールバックし、キャッシュも無ければ
 *   呼び出し側 (SyobocalChannelMap 等) が同梱データへフォールバックする
 * - 毎回ダウンロードせず、キャッシュファイル (data/metadataSharedData.json) を再利用する
 */
@injectable()
export default class SharedDataFetcher implements ISharedDataFetcher {
    private static readonly CACHE_FILE_NAME = 'metadataSharedData.json';
    private static readonly DEFAULT_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

    private log: ILogger;
    private cachePath: string;
    private timer: NodeJS.Timeout | null = null;

    constructor(
        @inject('IConfiguration') private config: IConfiguration,
        @inject('IProviderHttpClient') private http: IProviderHttpClient,
        @inject('ILoggerModel') logger: ILoggerModel,
    ) {
        this.log = logger.getLogger();
        this.cachePath = path.join(__dirname, '..', '..', '..', 'data', SharedDataFetcher.CACHE_FILE_NAME);
    }

    public async fetch(): Promise<SharedMetadataPayload | null> {
        const url = this.config.getConfig().metadataSharedDataUrl;
        if (typeof url === 'string' && url.length > 0) {
            try {
                const response = await this.http.get(url, { timeoutMs: 10000 });
                if (response.status >= 400) throw new Error(`SharedDataHttpStatus:${response.status}`);
                const payload = this.parse(response.text);
                if (payload) {
                    await this.saveCache(response.text).catch(e => {
                        this.log.system.warn(`failed to cache shared metadata: ${(e as Error).message}`);
                    });
                    return payload;
                }
            } catch (e) {
                this.log.system.warn(
                    `failed to fetch shared metadata from ${url} (${(e as Error).message}); falling back to cache`,
                );
            }
        }
        // URL 未設定 / 取得失敗 / パース失敗時はローカルキャッシュへフォールバックする
        return await this.loadCache();
    }

    public startAutoUpdate(onUpdate: (payload: SharedMetadataPayload) => void): void {
        const url = this.config.getConfig().metadataSharedDataUrl;
        if (typeof url !== 'string' || url.length === 0) return;
        const run = () => {
            this.fetch()
                .then(payload => {
                    if (payload) onUpdate(payload);
                })
                .catch(() => undefined);
        };
        run();
        const interval = this.config.getConfig().metadataSharedDataUpdateIntervalMs;
        const intervalMs = typeof interval === 'number' ? interval : SharedDataFetcher.DEFAULT_UPDATE_INTERVAL_MS;
        if (intervalMs <= 0 || this.timer !== null) return;
        this.timer = setInterval(run, intervalMs);
        if (typeof this.timer.unref === 'function') this.timer.unref();
    }

    private parse(text: string): SharedMetadataPayload | null {
        try {
            const parsed = JSON.parse(text) as unknown;
            if (parsed && typeof parsed === 'object') return parsed as SharedMetadataPayload;
            return null;
        } catch {
            return null;
        }
    }

    private async saveCache(text: string): Promise<void> {
        const tmp = `${this.cachePath}.tmp`;
        await FileUtil.mkdir(path.dirname(this.cachePath));
        await FileUtil.writeFile(tmp, text);
        await FileUtil.rename(tmp, this.cachePath);
    }

    private async loadCache(): Promise<SharedMetadataPayload | null> {
        try {
            const text = await FileUtil.readFile(this.cachePath);
            return this.parse(text);
        } catch {
            return null;
        }
    }
}
