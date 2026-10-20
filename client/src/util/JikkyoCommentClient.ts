import { createJikkyoThreadKey, createJikkyoPostPayload, shouldDropJikkyoEcho, validateJikkyoPost } from '../../../src/util/JikkyoPostUtil';

/**
 * ニコニコ実況 (NX-Jikkyo) コメント受信クライアント
 *
 * KonomiTV (https://github.com/tsukumijima/KonomiTV) の LiveCommentManager と同様に、
 * 視聴セッション → コメントセッションの 2 段階の WebSocket 接続 (旧ニコ生互換 API) でコメントを受信する
 * NX-Jikkyo: https://nx-jikkyo.tsukumijima.net
 */

export interface JikkyoComment {
    text: string;
    color: string; // CSS カラーコード
    type: 'top' | 'right' | 'bottom'; // 弾幕の描画位置
    size: 'big' | 'medium' | 'small'; // 弾幕の文字サイズ
    userId?: string;
    isSelf?: boolean;
}

export interface JikkyoCommentClientOption {
    serverUrl: string; // NX-Jikkyo サーバーの URL (例: https://nx-jikkyo.tsukumijima.net)
    jikkyoChannelId: string; // 実況チャンネル ID (例: jk9)
    onComment: (comment: JikkyoComment) => void; // コメント受信時に呼ばれる
    onError?: (message: string) => void; // 復帰不能なエラー発生時に呼ばれる
}

export default class JikkyoCommentClient {
    private option: JikkyoCommentClientOption;
    private watchSession: WebSocket | null = null;
    private commentSession: WebSocket | null = null;
    private keepSeatIntervalId: ReturnType<typeof setInterval> | null = null;
    private reconnectTimerId: ReturnType<typeof setTimeout> | null = null;
    private isInitialCommentsReceived: boolean = false;
    private isDestroyed: boolean = false;
    private reconnectCount: number = 0;
    private vposBaseTime: number | null = null;
    private lastPostAt: number = 0;
    private yourPostKey: string | null = null;
    private pendingEchoes: Array<{ text: string; sentAt: number }> = [];
    private postWaiters = new Set<() => void>();
    private static readonly POST_TIMEOUT_MS = 10_000;

    private static readonly MAX_RECONNECT_COUNT = 5;
    private static readonly RECONNECT_INTERVAL = 5 * 1000;

    // コメントコマンド (mail) の色指定 -> カラーコード変換テーブル
    private static readonly COLOR_TABLE: { [name: string]: string } = {
        white: '#FFFFFF',
        red: '#FF0000',
        pink: '#FF8080',
        orange: '#FFC000',
        yellow: '#FFFF00',
        green: '#00FF00',
        cyan: '#00FFFF',
        blue: '#0000FF',
        purple: '#C000FF',
        black: '#000000',
        white2: '#CCCC99',
        niconicowhite: '#CCCC99',
        red2: '#CC0033',
        truered: '#CC0033',
        pink2: '#FF33CC',
        orange2: '#FF6600',
        passionorange: '#FF6600',
        yellow2: '#999900',
        madyellow: '#999900',
        green2: '#00CC66',
        elementalgreen: '#00CC66',
        cyan2: '#00CCCC',
        blue2: '#3399FF',
        marineblue: '#3399FF',
        purple2: '#6633CC',
        nobleviolet: '#6633CC',
        black2: '#666666',
    };

    constructor(option: JikkyoCommentClientOption) {
        this.option = option;
    }

    /**
     * コメントの受信を開始する
     */
    public start(): void {
        this.connectWatchSession();
    }

    /**
     * すべての接続を切断する (以降の再接続も行わない)
     */
    public destroy(): void {
        this.isDestroyed = true;
        for (const cancel of [...this.postWaiters]) cancel();
        this.cleanup();
    }

    /**
     * 視聴セッション (watch session) へ接続する
     */
    private connectWatchSession(): void {
        if (this.isDestroyed === true) {
            return;
        }

        const baseUrl = this.option.serverUrl.replace(/\/+$/, '').replace(/^http/, 'ws');
        const ws = new WebSocket(`${baseUrl}/api/v1/channels/${this.option.jikkyoChannelId}/ws/watch`);
        this.watchSession = ws;

        ws.onopen = () => {
            // 接続に成功したので再接続カウントをリセット
            this.reconnectCount = 0;

            // 視聴開始要求
            ws.send(
                JSON.stringify({
                    type: 'startWatching',
                    data: {
                        stream: {
                            quality: 'abr',
                            protocol: 'hls',
                            latency: 'low',
                            chasePlay: false,
                        },
                        room: {
                            protocol: 'webSocket',
                            commentable: true,
                        },
                        reconnect: false,
                    },
                }),
            );
        };
        ws.onmessage = event => {
            this.onWatchSessionMessage(event);
        };
        ws.onclose = () => {
            this.scheduleReconnect();
        };
    }

    /**
     * 視聴セッションのメッセージ処理
     * @param event: MessageEvent
     */
    private onWatchSessionMessage(event: MessageEvent): void {
        let message: any;
        try {
            message = JSON.parse(event.data);
        } catch (err) {
            return;
        }

        switch (message.type) {
            // 座席取得成功 (keepSeat の送信間隔が通知される)
            case 'seat': {
                if (this.keepSeatIntervalId !== null) {
                    clearInterval(this.keepSeatIntervalId);
                }
                const keepIntervalSec = typeof message.data?.keepIntervalSec === 'number' ? message.data.keepIntervalSec : 30;
                this.keepSeatIntervalId = setInterval(() => {
                    if (this.watchSession !== null && this.watchSession.readyState === WebSocket.OPEN) {
                        this.watchSession.send(JSON.stringify({ type: 'keepSeat' }));
                    }
                }, keepIntervalSec * 1000);
                break;
            }

            // コメントサーバー (コメントセッション) の接続先情報
            case 'room':
            case 'messageServer': {
                // NX-Jikkyo / 現行ニコ生互換 API は data.uri を返す。
                // messageServer.uri は旧クライアント実装との互換用フォールバック。
                const uri = message.data?.uri ?? message.data?.messageServer?.uri;
                const threadId = message.data?.threadId;
                const vposBaseTime = message.data?.vposBaseTime;
                if (typeof vposBaseTime === 'string') this.vposBaseTime = Date.parse(vposBaseTime);
                // NX-Jikkyo は room で yourPostKey を直接返す (実測 2026-10-20)。
                // ニコ生互換の messageServer は hashedUserId だけを返すため、そこから KonomiTV と同じ規則で算出する
                this.yourPostKey =
                    typeof message.data?.yourPostKey === 'string' && message.data.yourPostKey.length > 0
                        ? message.data.yourPostKey
                        : createJikkyoThreadKey(message.data?.hashedUserId);
                if (typeof uri === 'string' && typeof threadId !== 'undefined') {
                    this.connectCommentSession(uri, String(threadId));
                } else {
                    console.warn('JikkyoCommentClient: comment room information is missing', message.data);
                }
                break;
            }

            // 死活監視
            case 'ping': {
                if (this.watchSession !== null && this.watchSession.readyState === WebSocket.OPEN) {
                    this.watchSession.send(JSON.stringify({ type: 'pong' }));
                }
                break;
            }

            // サーバーからのエラー通知
            case 'error': {
                console.error('JikkyoCommentClient: watch session error', message.data);
                break;
            }

            // サーバーからの切断通知
            case 'disconnect': {
                this.scheduleReconnect();
                break;
            }
        }
    }

    /**
     * コメントセッション (comment session) へ接続する
     * @param uri: string コメントサーバーの WebSocket URI
     * @param threadId: string スレッド ID
     */
    private connectCommentSession(uri: string, threadId: string): void {
        if (this.isDestroyed === true) {
            return;
        }

        if (this.commentSession !== null) {
            this.commentSession.onclose = null;
            this.commentSession.close();
            this.commentSession = null;
        }

        this.isInitialCommentsReceived = false;

        const ws = new WebSocket(uri);
        this.commentSession = ws;

        ws.onopen = () => {
            // スレッドへの接続要求
            // res_from: -10 で直近 10 件の過去コメントを受信する (過去コメントは描画しない)
            ws.send(
                JSON.stringify([
                    { ping: { content: 'rs:0' } },
                    { ping: { content: 'ps:0' } },
                    {
                        thread: {
                            thread: threadId,
                            version: '20061206',
                            user_id: '',
                            threadkey: this.yourPostKey,
                            res_from: -10,
                            with_global: 1,
                            scores: 1,
                            nicoru: 0,
                        },
                    },
                    { ping: { content: 'pf:0' } },
                    { ping: { content: 'rf:0' } },
                ]),
            );
        };
        ws.onmessage = event => {
            this.onCommentSessionMessage(event);
        };
        ws.onclose = () => {
            this.scheduleReconnect();
        };
    }

    /**
     * コメントセッションのメッセージ処理
     * @param event: MessageEvent
     */
    private onCommentSessionMessage(event: MessageEvent): void {
        let message: any;
        try {
            message = JSON.parse(event.data);
        } catch (err) {
            return;
        }

        // rf:0 は接続直後に受信する過去コメントの受信完了通知
        if (typeof message.ping !== 'undefined') {
            if (message.ping.content === 'rf:0') {
                this.isInitialCommentsReceived = true;
            }
            return;
        }

        if (typeof message.chat === 'undefined') {
            return;
        }

        // 過去コメントは描画しない
        if (this.isInitialCommentsReceived === false) {
            return;
        }

        const content: string = typeof message.chat.content === 'string' ? message.chat.content : '';
        if (shouldDropJikkyoEcho({ yourpost: message.chat.yourpost, content }, this.isInitialCommentsReceived, this.pendingEchoes, Date.now())) return;

        // 空コメントや運営コマンド (/nicoad など) は描画しない
        if (content.length === 0 || content.startsWith('/') === true) {
            return;
        }

        const command = JikkyoCommentClient.parseCommand(message.chat.mail);
        this.option.onComment({
            text: content,
            color: command.color,
            type: command.type,
            size: command.size,
            userId: typeof message.chat.user_id === 'string' ? message.chat.user_id : undefined,
            isSelf: message.chat.yourpost === 1,
        });
    }

    /**
     * NX-Jikkyo の視聴セッションへ匿名コメントを投稿する。
     * 送信処理は KonomiTV `client/src/services/player/managers/LiveCommentManager.ts` の sendComment を移植。
     * @param data DPlayer コメント入力
     * @param success 投稿成功時
     * @param error 投稿失敗時
     */
    public sendComment(
        data: { text: string; color: string; type: 'top' | 'right' | 'bottom'; size: 'big' | 'medium' | 'small' },
        success: () => void,
        error: (message: string) => void,
    ): void {
        const text = data.text.trim();
        const validationError = validateJikkyoPost(text, Date.now(), this.lastPostAt === 0 ? null : this.lastPostAt);
        if (validationError !== null) return error(validationError);
        if (this.watchSession?.readyState !== WebSocket.OPEN || this.vposBaseTime === null) return error('実況サーバーに接続していません');
        const now = Date.now();
        let payload: ReturnType<typeof createJikkyoPostPayload>;
        try {
            payload = createJikkyoPostPayload({ ...data, text }, now, this.vposBaseTime);
        } catch {
            return error('コメントの色設定が無効です');
        }
        this.lastPostAt = now;
        const ws = this.watchSession;
        this.pendingEchoes.push({ text, sentAt: now });
        const onMessage = (event: MessageEvent): void => {
            let message: any;
            try {
                message = JSON.parse(event.data);
            } catch {
                return;
            }
            if (message.type === 'postCommentResult') finish(null);
            else if (message.type === 'error') finish(message.data?.code === 'COMMENT_POST_NOT_ALLOWED' ? 'コメントが許可されていません' : 'コメントの送信に失敗しました');
        };
        const onClose = (): void => finish('実況サーバーから切断されました');
        const timer = setTimeout(() => finish('コメント送信がタイムアウトしました'), JikkyoCommentClient.POST_TIMEOUT_MS);
        const finish = (message: string | null): void => {
            clearTimeout(timer);
            ws.removeEventListener('message', onMessage);
            ws.removeEventListener('close', onClose);
            this.postWaiters.delete(cancel);
            if (message === null) success();
            else error(message);
        };
        const cancel = (): void => finish('コメント送信を中断しました');
        this.postWaiters.add(cancel);
        ws.addEventListener('message', onMessage);
        ws.addEventListener('close', onClose);
        ws.send(JSON.stringify(payload));
    }

    /**
     * コメントコマンド (mail) をパースして描画スタイルへ変換する
     * @param mail: string | undefined
     */
    public static parseCommand(mail?: string): { color: string; type: 'top' | 'right' | 'bottom'; size: 'big' | 'medium' | 'small' } {
        let color = '#FFFFFF';
        let type: 'top' | 'right' | 'bottom' = 'right';
        let size: 'big' | 'medium' | 'small' = 'medium';

        if (typeof mail === 'string' && mail.length > 0) {
            for (const command of mail.toLowerCase().split(/\s+/)) {
                if (typeof JikkyoCommentClient.COLOR_TABLE[command] !== 'undefined') {
                    color = JikkyoCommentClient.COLOR_TABLE[command];
                } else if (/^#[0-9a-f]{6}$/.test(command) === true) {
                    color = command;
                } else if (command === 'ue') {
                    type = 'top';
                } else if (command === 'shita') {
                    type = 'bottom';
                } else if (command === 'naka') {
                    type = 'right';
                } else if (command === 'big' || command === 'medium' || command === 'small') {
                    size = command;
                }
            }
        }

        return { color: color, type: type, size: size };
    }

    /**
     * 再接続を予約する
     */
    private scheduleReconnect(): void {
        if (this.isDestroyed === true) {
            return;
        }

        this.cleanup();

        if (this.reconnectCount >= JikkyoCommentClient.MAX_RECONNECT_COUNT) {
            if (typeof this.option.onError !== 'undefined') {
                this.option.onError('ニコニコ実況サーバーへの再接続に失敗しました');
            }
            return;
        }
        this.reconnectCount++;

        this.reconnectTimerId = setTimeout(() => {
            this.connectWatchSession();
        }, JikkyoCommentClient.RECONNECT_INTERVAL);
    }

    /**
     * タイマーと WebSocket 接続を破棄する
     */
    private cleanup(): void {
        for (const cancel of [...this.postWaiters]) cancel();
        if (this.keepSeatIntervalId !== null) {
            clearInterval(this.keepSeatIntervalId);
            this.keepSeatIntervalId = null;
        }

        if (this.reconnectTimerId !== null) {
            clearTimeout(this.reconnectTimerId);
            this.reconnectTimerId = null;
        }

        if (this.watchSession !== null) {
            this.watchSession.onopen = null;
            this.watchSession.onmessage = null;
            this.watchSession.onclose = null;
            if (this.watchSession.readyState === WebSocket.OPEN || this.watchSession.readyState === WebSocket.CONNECTING) {
                this.watchSession.close();
            }
            this.watchSession = null;
        }

        if (this.commentSession !== null) {
            this.commentSession.onopen = null;
            this.commentSession.onmessage = null;
            this.commentSession.onclose = null;
            if (this.commentSession.readyState === WebSocket.OPEN || this.commentSession.readyState === WebSocket.CONNECTING) {
                this.commentSession.close();
            }
            this.commentSession = null;
        }

        this.isInitialCommentsReceived = false;
    }
}
