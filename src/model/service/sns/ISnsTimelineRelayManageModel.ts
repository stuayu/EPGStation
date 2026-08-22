import type WebSocket from 'ws';

export default interface ISnsTimelineRelayManageModel {
    /**
     * クライアントとの WebSocket 接続 1 本に対して中継セッションを開始する。
     * 接続直後は購読しておらず、クライアントからの `{ type: 'subscribe', ... }` メッセージを待つ
     * @param ws: WebSocket クライアントとの接続
     * @param userId: number | null 認証無効・匿名時は null
     */
    start(ws: WebSocket, userId: number | null): void;
    /**
     * 保持中のセッション数 (テスト・監視用)
     * @return number
     */
    size(): number;
}
