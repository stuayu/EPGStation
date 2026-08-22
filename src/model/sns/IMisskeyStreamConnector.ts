import type WebSocket from 'ws';

/**
 * Misskey の Streaming API (`wss://<host>/streaming`) への上流接続を作るファクトリ。
 * インターフェースに切り出すのは、WebSocket 中継のテスト (購読管理・再接続・後始末) を
 * 実ネットワークなしで行うため (テストではフェイクの WebSocket 実装を返す)
 */
export default interface IMisskeyStreamConnector {
    /**
     * 上流 (Misskey) への WebSocket 接続を作る
     * @param host: string
     * @param token: string アクセストークン
     * @return WebSocket
     */
    connect(host: string, token: string): WebSocket;
}
