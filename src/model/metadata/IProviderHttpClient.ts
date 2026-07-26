export interface ProviderHttpOption {
    headers?: Record<string, string>;
    timeoutMs?: number;
    attempts?: number;
    minimumIntervalMs?: number;
}
export interface ProviderHttpResponse {
    status: number;
    headers: Headers;
    text: string;
    json<T>(): T;
}
export default interface IProviderHttpClient {
    get(url: string, option?: ProviderHttpOption): Promise<ProviderHttpResponse>;
}
