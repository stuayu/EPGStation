export interface ProviderHttpOption {
    headers?: Record<string, string>;
    timeoutMs?: number;
    attempts?: number;
    minimumIntervalMs?: number;
    // 'buffer' を指定すると本文をバイナリとして受け取る (画像取得用)。
    // 既定 ('text') では従来どおり text/json のみが使える
    responseType?: 'text' | 'buffer';
}
export interface ProviderHttpResponse {
    status: number;
    headers: Headers;
    text: string;
    json<T>(): T;
    // responseType: 'buffer' を指定した場合のみ入る
    buffer?: Buffer;
}
export default interface IProviderHttpClient {
    get(url: string, option?: ProviderHttpOption): Promise<ProviderHttpResponse>;
    post(url: string, body: string, option?: ProviderHttpOption): Promise<ProviderHttpResponse>;
}
