import Util from '@/util/Util';
import * as apid from '../../../api';

/**
 * SNS タイムライン WebSocket (`<subDirectory>/api/sns/ws`) へ渡す購読パラメータ
 */
export interface SnsTimelineSubscribeParam {
    accountId: apid.SnsAccountId;
    timelineType: apid.SnsTimelineType;
    channelId?: string;
}

export interface SnsTimelineSocketCallbacks {
    // 新着ノートを受信したとき
    onNote: (note: apid.SnsTimelineNote) => void;
    // 購読が確立したとき
    onSubscribed?: () => void;
    // サーバー側 (中継) からのエラー、または接続自体のエラー
    onError?: (message: string) => void;
}

/**
 * Misskey リアルタイムタイムラインの WebSocket 中継 (`SnsTimelineWebSocketServer`) に接続するクライアント。
 *
 * `DataBroadcastingManager` (データ放送用 WebSocket) と同じ流儀のプレーンな TypeScript クラスとして実装する
 * (Vue コンポーネントではない)。呼び出し側の Vue コンポーネントはこのクラスのインスタンスを
 * リアクティブでないフィールドとして保持し、メソッド (`this.onNoteReceived` 等) をそのまま
 * コールバックとして渡すこと (フィールドに束縛したクロージャを経由すると `this` が
 * Vue インスタンスでなくなる問題を避けるため)。
 *
 * 自動再接続は行わない (データ放送 WebSocket も同様の方針)。切断時は `onError` で呼び出し側へ知らせ、
 * 再接続するかどうかの判断は呼び出し側 (UI 側で「再接続」操作を出す等) に委ねる
 */
export default class SnsTimelineSocket {
    private ws: WebSocket | null = null;
    private readonly callbacks: SnsTimelineSocketCallbacks;
    private isClosing = false;

    constructor(callbacks: SnsTimelineSocketCallbacks) {
        this.callbacks = callbacks;
    }

    /**
     * WebSocket へ接続し、接続確立後に購読メッセージを送る
     * @param param: SnsTimelineSubscribeParam
     */
    public connect(param: SnsTimelineSubscribeParam): void {
        this.close();
        this.isClosing = false;

        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${proto}//${location.host}${Util.getSubDirectory()}/api/sns/ws`;

        const ws = new WebSocket(url);
        this.ws = ws;

        ws.onopen = () => {
            if (this.ws !== ws) return;
            ws.send(
                JSON.stringify({
                    type: 'subscribe',
                    accountId: param.accountId,
                    timelineType: param.timelineType,
                    channelId: param.channelId,
                }),
            );
        };

        ws.onmessage = event => {
            if (this.ws !== ws) return;
            this.handleMessage(event.data);
        };

        ws.onerror = () => {
            if (this.ws !== ws || this.isClosing === true) return;
            this.callbacks.onError?.('SNS タイムラインとの接続でエラーが発生しました');
        };

        ws.onclose = event => {
            if (this.ws !== ws || this.isClosing === true) return;
            // 1000 (正常終了) 以外は呼び出し側へ知らせる
            if (event.code !== 1000) {
                this.callbacks.onError?.(`SNS タイムラインとの接続が切断されました (code: ${event.code})`);
            }
        };
    }

    /**
     * 受信メッセージを解釈し、対応するコールバックを呼ぶ
     * @param data: unknown
     */
    private handleMessage(data: unknown): void {
        if (typeof data !== 'string') return;

        let msg: { type?: string; note?: apid.SnsTimelineNote; message?: string };
        try {
            msg = JSON.parse(data);
        } catch (err) {
            return;
        }

        if (msg.type === 'note' && typeof msg.note !== 'undefined') {
            this.callbacks.onNote(msg.note);
        } else if (msg.type === 'subscribed') {
            this.callbacks.onSubscribed?.();
        } else if (msg.type === 'error') {
            this.callbacks.onError?.(SnsTimelineSocket.translateErrorMessage(msg.message));
        }
    }

    /**
     * サーバー側のエラーコードを画面に出せる日本語へ変換する
     * @param code: string | undefined
     * @return string
     */
    private static translateErrorMessage(code: string | undefined): string {
        switch (code) {
            case 'SnsAccountIsNull':
                return 'SNS 連携アカウントが見つかりません';
            case 'SnsTimelineWsProviderNotSupported':
                return 'このアカウントはリアルタイムタイムラインに対応していません';
            case 'SnsAccountNeedsReauth':
                return 'SNS アカウントの再連携が必要です';
            case 'SnsTimelineChannelIdIsRequired':
                return 'チャンネルを選択してください';
            case 'SnsTimelineWsReconnectGaveUp':
                return 'SNS 側との接続が繰り返し切断されたため中継を諦めました';
            case 'SnsTimelineWsUpstreamConnectFailed':
                return 'SNS 側への接続に失敗しました';
            default:
                return `SNS タイムラインの取得でエラーが発生しました (${code ?? '不明なエラー'})`;
        }
    }

    /**
     * WebSocket を閉じる。以後このインスタンスからのコールバックは呼ばれない
     */
    public close(): void {
        this.isClosing = true;
        if (this.ws !== null) {
            try {
                this.ws.close(1000);
            } catch (err) {
                // 既に閉じている場合等は無視する
            }
            this.ws = null;
        }
    }
}
