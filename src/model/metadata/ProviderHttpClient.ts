import { injectable } from 'inversify';
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

    // ホストごとの直列化キュー (前段の Promise を繋げて次のリクエストを待たせる)
    private queues = new Map<string, Promise<void>>();
    private last = new Map<string, number>();

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
        const interval = Math.max(0, option.minimumIntervalMs ?? ProviderHttpClient.DEFAULT_MINIMUM_INTERVAL_MS);
        const attempts = Math.max(1, option.attempts ?? ProviderHttpClient.DEFAULT_ATTEMPTS);
        let last: unknown;
        for (let i = 1; i <= attempts; i++) {
            const wait = Math.max(0, (this.last.get(host) ?? 0) + interval - Date.now());
            if (wait > 0) await new Promise(r => setTimeout(r, wait));
            this.last.set(host, Date.now());
            try {
                const response = await fetch(url, {
                    method,
                    body,
                    headers: { 'user-agent': 'EPGStation-metadata/1.0', ...option.headers },
                    signal: AbortSignal.timeout(option.timeoutMs ?? ProviderHttpClient.DEFAULT_TIMEOUT_MS),
                });
                if (response.status === 304) {
                    return { status: response.status, headers: response.headers, text: '', json: <T>() => null as T };
                }
                // バイナリ指定時は本文を Buffer で受け取る (画像などテキスト化できない応答用)
                const isBuffer = option.responseType === 'buffer';
                const buffer = isBuffer === true ? Buffer.from(await response.arrayBuffer()) : undefined;
                const text = isBuffer === true ? '' : await response.text();
                if (response.status === 429) {
                    if (i < attempts) {
                        await new Promise(r => setTimeout(r, this.retryAfterMs(response.headers, i)));
                        continue;
                    }
                    throw new Error(`ProviderHttpStatus:${response.status}`);
                }
                if (response.status >= 500) throw new Error(`ProviderHttpStatus:${response.status}`);
                return {
                    status: response.status,
                    headers: response.headers,
                    text,
                    json: <T>() => JSON.parse(text) as T,
                    buffer,
                };
            } catch (e) {
                last = e;
                if (i < attempts) await new Promise(r => setTimeout(r, 100 * 2 ** (i - 1)));
            }
        }
        throw last;
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
