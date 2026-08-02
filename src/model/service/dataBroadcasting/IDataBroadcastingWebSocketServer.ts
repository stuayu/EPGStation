import * as http from 'http';

export default interface IDataBroadcastingWebSocketServer {
    /**
     * データ放送用 WebSocket の upgrade ハンドリングを開始する
     * @param servers: http.Server[] Web API (express アプリ) を配信している http/https サーバー
     */
    initialize(servers: http.Server[]): void;
}
