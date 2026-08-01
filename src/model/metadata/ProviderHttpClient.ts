import { inject, injectable, optional } from 'inversify';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IProviderHttpClient, { ProviderHttpOption, ProviderHttpResponse } from './IProviderHttpClient';

/**
 * 外部メタデータプロバイダーへの HTTP アクセスを一元管理するクライアント。
 * ホスト単位で「直列化キュー」を持ち、複数リクエストが同時に発火しないよう
 * 常に前回リクエストの完了を待ってから次のリクエストを開始する (アクセスマナー厳守)。
 * 5xx / 429 はリトライし、429 は Retry-After ヘッダを尊重する。
 */
@injectable()
export default class ProviderHttpClient implements IProviderHttpClient {
    private static readonly DEFAULT_MINIMUM_INTERVAL_MS = 250;
    private static readonly DEFAULT_TIMEOUT_MS = 10000;
    private static readonly DEFAULT_ATTEMPTS = 3;
    private static readonly MAX_RETRY_AFTER_MS = 60000;

    // ホストごとの最小リクエスト間隔 (ms)。呼び出し側が option.minimumIntervalMs を指定した場合はそちらが優先。
    // しょぼいカレンダーは Cloudflare のレート制限が厳しく、既定の 250ms では 429 (error 1015) を返す
    private static readonly HOST_MINIMUM_INTERVAL_MS: Readonly<Record<string, number>> = {
        'cal.syoboi.jp': 1500,
    };
    // 429 を受けたホストの最小間隔を引き上げる倍率と、その上限 (ms)
    private static readonly THROTTLE_FACTOR = 2;
    private static readonly MAX_THROTTLED_INTERVAL_MS = 10000;

    // ログに出す URL の最大長 (Wikidata の SPARQL などクエリが極端に長いものを切り詰める)
    private static readonly LOG_URL_MAX_LENGTH = 300;

    // ホストごとの直列化キュー (前段の Promise を繋げて次のリクエストを待たせる)
    private queues = new Map<string, Promise<void>>();
    private last = new Map<string, number>();
    // 429 を受けたホストについて、以後適用する最小間隔 (ms)
    private throttled = new Map<string, number>();
    private log: ILogger | null;

    /**
     * @param logger: ILoggerModel ロガー (未注入でも動作する)
     */
    constructor(@inject('ILoggerModel') @optional() logger?: ILoggerModel) {
        this.log = typeof logger?.getLogger === 'function' ? logger.getLogger() : null;
    }

    /**
     * GET リクエストを送信する
     * @param url string
     * @param option ProviderHttpOption
     * @return Promise<ProviderHttpResponse>
     */
    public async get(url: string, option: ProviderHttpOption = {}): Promise<ProviderHttpResponse> {
        return await this.enqueue(url, () => this.request('GET', url, undefined, option));
    }

    /**
     * POST リクエストを送信する
     * @param url string
     * @param body string
     * @param option ProviderHttpOption
     * @return Promise<ProviderHttpResponse>
     */
    public async post(url: string, body: string, option: ProviderHttpOption = {}): Promise<ProviderHttpResponse> {
        return await this.enqueue(url, () => this.request('POST', url, body, option));
    }

    /**
     * host 単位でリクエストを直列化する。同一 host への呼び出しが並列に来ても
     * 前段の完了 (成否問わず) を待ってから次を実行するため、レート制限用の
     * 待機時間計算 (this.last) が並列実行によって無視されることがなくなる。
     */
    private async enqueue<T>(url: string, task: () => Promise<T>): Promise<T> {
        const host = new URL(url).host;
        const previous = this.queues.get(host) ?? Promise.resolve();
        let release: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        this.queues.set(
            host,
            previous.then(() => gate),
        );
        await previous;
        try {
            return await task();
        } finally {
            release!();
        }
    }

    private async request(
        method: 'GET' | 'POST',
        url: string,
        body: string | undefined,
        option: ProviderHttpOption,
    ): Promise<ProviderHttpResponse> {
        const host = new URL(url).host;
        const interval = this.minimumIntervalMs(host, option);
        const attempts = Math.max(1, option.attempts ?? ProviderHttpClient.DEFAULT_ATTEMPTS);
        let last: unknown;
        for (let i = 1; i <= attempts; i++) {
            const wait = Math.max(0, (this.last.get(host) ?? 0) + interval - Date.now());
            if (wait > 0) await new Promise(r => setTimeout(r, wait));
            this.last.set(host, Date.now());
            const startedAt = Date.now();
            this.log?.system.debug(
                `provider http: ${method} ${ProviderHttpClient.shortUrl(url)} (attempt ${i}/${attempts})`,
            );
            try {
                const response = await fetch(url, {
                    method,
                    body,
                    headers: { 'user-agent': 'EPGStation-metadata/1.0', ...option.headers },
                    signal: AbortSignal.timeout(option.timeoutMs ?? ProviderHttpClient.DEFAULT_TIMEOUT_MS),
                });
                if (response.status === 304) {
                    this.log?.system.debug(
                        `provider http: 304 ${ProviderHttpClient.shortUrl(url)} (${Date.now() - startedAt}ms, not modified)`,
                    );

                    return { status: response.status, headers: response.headers, text: '', json: <T>() => null as T };
                }
                // バイナリ指定時は本文を Buffer で受け取る (画像などテキスト化できない応答用)
                const isBuffer = option.responseType === 'buffer';
                const buffer = isBuffer === true ? Buffer.from(await response.arrayBuffer()) : undefined;
                const text = isBuffer === true ? '' : await response.text();
                const size = isBuffer === true ? (buffer?.length ?? 0) : text.length;
                this.log?.system.debug(
                    `provider http: ${response.status} ${ProviderHttpClient.shortUrl(url)} (${Date.now() - startedAt}ms, ${size} bytes)`,
                );
                if (response.status === 429) {
                    const retryAfter = this.retryAfterMs(response.headers, i);
                    // 以後このホストへのリクエスト間隔を広げる (同じ同期の続きで叩き続けて弾かれ続けるのを防ぐ)
                    const next = this.throttle(host, interval);
                    this.log?.system.warn(
                        `provider http: rate limited (429) ${ProviderHttpClient.shortUrl(url)}` +
                            `${i < attempts ? `, retrying in ${retryAfter}ms` : ', giving up'}` +
                            `; minimum interval for ${host} is now ${next}ms`,
                    );
                    if (i < attempts) {
                        await new Promise(r => setTimeout(r, retryAfter));
                        continue;
                    }
                    throw new Error(`ProviderHttpStatus:${response.status}`);
                }
                if (response.status >= 500) throw new Error(`ProviderHttpStatus:${response.status}`);
                if (response.status >= 400) {
                    this.log?.system.warn(
                        `provider http: ${response.status} ${ProviderHttpClient.shortUrl(url)} ${text.slice(0, 200)}`,
                    );
                }
                return {
                    status: response.status,
                    headers: response.headers,
                    text,
                    json: <T>() => JSON.parse(text) as T,
                    buffer,
                };
            } catch (e) {
                last = e;
                const message = e instanceof Error ? e.message : String(e);
                this.log?.system.warn(
                    `provider http: ${method} ${ProviderHttpClient.shortUrl(url)} failed (attempt ${i}/${attempts}, ${Date.now() - startedAt}ms): ${message}`,
                );
                if (i < attempts) await new Promise(r => setTimeout(r, 100 * 2 ** (i - 1)));
            }
        }
        this.log?.system.error(
            `provider http: ${method} ${ProviderHttpClient.shortUrl(url)} gave up after ${attempts} attempts`,
        );
        throw last;
    }

    /**
     * このリクエストに適用する最小リクエスト間隔 (ms) を決める。
     * 優先順位は「呼び出し側の指定 > 429 を受けて引き上げた値 > ホスト別の既定 > 全体の既定」
     * @param host: string
     * @param option: ProviderHttpOption
     * @return number
     */
    private minimumIntervalMs(host: string, option: ProviderHttpOption): number {
        if (typeof option.minimumIntervalMs === 'number') {
            return Math.max(0, option.minimumIntervalMs);
        }

        return Math.max(
            this.throttled.get(host) ?? 0,
            ProviderHttpClient.HOST_MINIMUM_INTERVAL_MS[host] ?? ProviderHttpClient.DEFAULT_MINIMUM_INTERVAL_MS,
        );
    }

    /**
     * 429 を受けたホストの最小間隔を引き上げる (上限あり)
     * @param host: string
     * @param current: number 今回適用していた間隔 (ms)
     * @return number 引き上げ後の間隔 (ms)
     */
    private throttle(host: string, current: number): number {
        const base = Math.max(current, ProviderHttpClient.DEFAULT_MINIMUM_INTERVAL_MS);
        const next = Math.min(ProviderHttpClient.MAX_THROTTLED_INTERVAL_MS, base * ProviderHttpClient.THROTTLE_FACTOR);
        this.throttled.set(host, next);

        return next;
    }

    /**
     * ログ用に URL を切り詰める (SPARQL などクエリが極端に長いものがあるため)
     * @param url: string
     * @return string
     */
    private static shortUrl(url: string): string {
        return url.length <= ProviderHttpClient.LOG_URL_MAX_LENGTH
            ? url
            : `${url.slice(0, ProviderHttpClient.LOG_URL_MAX_LENGTH)}...(${url.length} chars)`;
    }

    /**
     * Retry-After ヘッダ (秒 or HTTP-date) を待機時間 (ms) に変換する。
     * ヘッダが無い/不正な場合は指数バックオフにフォールバックする
     */
    private retryAfterMs(headers: Headers, attempt: number): number {
        const value = headers.get('retry-after');
        if (value !== null) {
            const seconds = Number(value);
            if (Number.isFinite(seconds))
                return Math.min(ProviderHttpClient.MAX_RETRY_AFTER_MS, Math.max(0, seconds * 1000));
            const date = Date.parse(value);
            if (Number.isFinite(date))
                return Math.min(ProviderHttpClient.MAX_RETRY_AFTER_MS, Math.max(0, date - Date.now()));
        }
        return Math.min(ProviderHttpClient.MAX_RETRY_AFTER_MS, 500 * 2 ** (attempt - 1));
    }
}
