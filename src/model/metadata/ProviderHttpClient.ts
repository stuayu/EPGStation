import { injectable } from 'inversify';
import IProviderHttpClient, { ProviderHttpOption, ProviderHttpResponse } from './IProviderHttpClient';
@injectable()
export default class ProviderHttpClient implements IProviderHttpClient {
    private last = new Map<string, number>();
    async get(url: string, option: ProviderHttpOption = {}): Promise<ProviderHttpResponse> {
        const host = new URL(url).host;
        const interval = Math.max(0, option.minimumIntervalMs ?? 250);
        const wait = Math.max(0, (this.last.get(host) ?? 0) + interval - Date.now());
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        let last: unknown;
        for (let i = 1; i <= Math.max(1, option.attempts ?? 3); i++) {
            this.last.set(host, Date.now());
            try {
                const response = await fetch(url, {
                    headers: { 'user-agent': 'EPGStation-metadata/1.0', ...option.headers },
                    signal: AbortSignal.timeout(option.timeoutMs ?? 10000),
                });
                const text = await response.text();
                if (response.status >= 500) throw new Error(`ProviderHttpStatus:${response.status}`);
                return {
                    status: response.status,
                    headers: response.headers,
                    text,
                    json: <T>() => JSON.parse(text) as T,
                };
            } catch (e) {
                last = e;
                if (i < (option.attempts ?? 3)) await new Promise(r => setTimeout(r, 100 * 2 ** (i - 1)));
            }
        }
        throw last;
    }
}
