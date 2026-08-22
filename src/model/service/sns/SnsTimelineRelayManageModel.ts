import { randomUUID } from 'crypto';
import { inject, injectable } from 'inversify';
import type WebSocket from 'ws';
import ISnsAccountDB from '../../db/ISnsAccountDB';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import ISecretCrypto from '../../security/ISecretCrypto';
import IMisskeyClient from '../../sns/IMisskeyClient';
import IMisskeyStreamConnector from '../../sns/IMisskeyStreamConnector';
import { convertMisskeyNoteToTimelineNote } from '../../sns/MisskeyTimelineConverter';
import ISnsTimelineRelayManageModel from './ISnsTimelineRelayManageModel';

interface MisskeyCredential {
    accessToken: string;
}

// クライアントから送られてくる購読メッセージ
interface SubscribeMessage {
    type: 'subscribe';
    accountId: number;
    timelineType: 'home' | 'social' | 'local' | 'channel';
    channelId?: string;
}

// 現在の購読内容 (再接続時に同じ内容で張り直すために保持する)
interface CurrentSubscription {
    host: string;
    token: string;
    // Misskey 側の channel 購読 id。再接続でも使い回す
    connectId: string;
    connectBody: string;
}

interface RelaySession {
    id: string;
    ws: WebSocket;
    userId: number | null;
    closed: boolean;
    upstream: WebSocket | null;
    reconnectTimer: NodeJS.Timeout | null;
    reconnectAttempts: number;
    current: CurrentSubscription | null;
}

/**
 * Misskey のリアルタイムタイムライン (Streaming API) をクライアントへ中継する。
 * クライアント ⇔ EPGStation サーバー ⇔ Misskey の 2 段構成で、トークンを持つのはサーバーだけ。
 * WebSocket 接続 1 本 = 1 セッションとして管理し、クライアントからの `subscribe` / `unsubscribe`
 * メッセージに応じて上流 (Misskey) への接続を張り替える。上流が予期せず切れた場合は
 * 指数バックオフで再接続し、クライアント切断時は上流も必ず閉じる
 */
@injectable()
export default class SnsTimelineRelayManageModel implements ISnsTimelineRelayManageModel {
    private static readonly RECONNECT_BASE_MS = 1000;
    private static readonly RECONNECT_MAX_MS = 30 * 1000;
    private static readonly RECONNECT_MAX_ATTEMPTS = 10;
    private static readonly CHANNEL_NAME_MAP: Record<SubscribeMessage['timelineType'], string> = {
        home: 'homeTimeline',
        social: 'hybridTimeline',
        local: 'localTimeline',
        channel: 'channel',
    };

    /**
     * 再接続までの待機時間 (ms) を返す。上限回数を超えたら null (再接続を諦める)
     * @param attempt: number これまでの再接続試行回数
     * @return number | null
     */
    public static defaultReconnectDelay(attempt: number): number | null {
        if (attempt >= SnsTimelineRelayManageModel.RECONNECT_MAX_ATTEMPTS) return null;

        return Math.min(
            SnsTimelineRelayManageModel.RECONNECT_BASE_MS * 2 ** attempt,
            SnsTimelineRelayManageModel.RECONNECT_MAX_MS,
        );
    }

    private log: ILogger;
    private sessions: Map<string, RelaySession> = new Map();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('ISnsAccountDB') private readonly snsAccountDB: ISnsAccountDB,
        @inject('ISecretCrypto') private readonly crypto: ISecretCrypto,
        @inject('IMisskeyStreamConnector') private readonly connector: IMisskeyStreamConnector,
        // リアクションのカスタム絵文字 URL 解決に使う (WS 経由の note には reactionEmojis が
        // 入っていないことがあるため、インスタンス単位の絵文字キャッシュ (getEmojis) で補う)
        @inject('IMisskeyClient') private readonly misskeyClient: IMisskeyClient,
        // テスト用: 既定は指数バックオフ。テストでは短い遅延の関数に差し替える
        private readonly reconnectDelayFn: (
            attempt: number,
        ) => number | null = SnsTimelineRelayManageModel.defaultReconnectDelay,
    ) {
        this.log = logger.getLogger();
    }

    public start(ws: WebSocket, userId: number | null): void {
        const id = randomUUID();
        const session: RelaySession = {
            id,
            ws,
            userId,
            closed: false,
            upstream: null,
            reconnectTimer: null,
            reconnectAttempts: 0,
            current: null,
        };
        this.sessions.set(id, session);

        ws.on('message', (data: WebSocket.RawData) => this.onClientMessage(session, data));
        ws.on('close', () => this.closeSession(session));
        ws.on('error', (err: Error) => {
            this.log.system.warn(`SnsTimelineRelayManageModel: client ws error (${err.message})`);
            this.closeSession(session);
        });
    }

    public size(): number {
        return this.sessions.size;
    }

    /**
     * クライアントからのメッセージを処理する
     */
    private onClientMessage(session: RelaySession, data: WebSocket.RawData): void {
        if (session.closed === true) return;

        let parsed: unknown;
        try {
            parsed = JSON.parse(data.toString());
        } catch (e) {
            this.sendToClient(session, { type: 'error', message: 'SnsTimelineWsInvalidMessage' });

            return;
        }
        if (typeof parsed !== 'object' || parsed === null) return;
        const message = parsed as Record<string, unknown>;

        if (message.type === 'unsubscribe') {
            // 意図した停止。上流を閉じたまま再接続しない
            this.closeUpstream(session);

            return;
        }
        if (message.type !== 'subscribe') return;

        void this.subscribe(session, message);
    }

    /**
     * 購読要求を検証し、上流 (Misskey) への接続を張り替える
     */
    private async subscribe(session: RelaySession, message: Record<string, unknown>): Promise<void> {
        // 購読変更のたびに既存の上流を必ず閉じてから張り直す (同じアカウント・購読の多重接続を防ぐ)
        this.closeUpstream(session);

        const accountId = Number(message.accountId);
        const timelineType = String(message.timelineType ?? 'home') as SubscribeMessage['timelineType'];
        const channelId = typeof message.channelId === 'string' ? message.channelId : undefined;

        if (!Number.isInteger(accountId)) {
            this.sendToClient(session, { type: 'error', message: 'SnsTimelineWsInvalidAccountId' });

            return;
        }
        const channel = SnsTimelineRelayManageModel.CHANNEL_NAME_MAP[timelineType];
        if (typeof channel === 'undefined') {
            this.sendToClient(session, { type: 'error', message: 'SnsTimelineWsInvalidTimelineType' });

            return;
        }
        if (timelineType === 'channel' && (typeof channelId !== 'string' || channelId === '')) {
            this.sendToClient(session, { type: 'error', message: 'SnsTimelineChannelIdIsRequired' });

            return;
        }

        const account = await this.snsAccountDB.findById(accountId);
        // 存在しない場合と他人のアカウントの場合を同じエラーにして存在を推測されないようにする
        if (account === null || account.userId !== session.userId) {
            this.sendToClient(session, { type: 'error', message: 'SnsAccountIsNull' });

            return;
        }
        if (account.provider !== 'misskey' || account.instanceUrl === null) {
            this.sendToClient(session, { type: 'error', message: 'SnsTimelineWsProviderNotSupported' });

            return;
        }
        if (this.crypto.isEncrypted(account.credential) === false) {
            this.sendToClient(session, { type: 'error', message: 'SnsAccountNeedsReauth' });

            return;
        }

        // このセッションが既に閉じられている / 別の購読に張り替えられていたら中断する
        if (session.closed === true) return;

        const credential = JSON.parse(this.crypto.decrypt(account.credential)) as MisskeyCredential;
        const connectId = randomUUID();
        session.current = {
            host: account.instanceUrl,
            token: credential.accessToken,
            connectId,
            connectBody: JSON.stringify({
                type: 'connect',
                body: {
                    channel,
                    id: connectId,
                    params: timelineType === 'channel' ? { channelId } : {},
                },
            }),
        };
        session.reconnectAttempts = 0;

        this.connectUpstream(session);
    }

    /**
     * 上流 (Misskey) への WebSocket 接続を開く
     */
    private connectUpstream(session: RelaySession): void {
        if (session.closed === true || session.current === null) return;
        const current = session.current;

        let upstream: WebSocket;
        try {
            upstream = this.connector.connect(current.host, current.token);
        } catch (err) {
            this.log.system.error('SnsTimelineRelayManageModel: failed to open upstream connection');
            this.log.system.error(err as Error);
            this.sendToClient(session, { type: 'error', message: 'SnsTimelineWsUpstreamConnectFailed' });

            return;
        }
        session.upstream = upstream;

        upstream.on('open', () => {
            if (session.closed === true || session.upstream !== upstream || session.current !== current) return;
            upstream.send(current.connectBody);
            session.reconnectAttempts = 0;
            this.sendToClient(session, { type: 'subscribed' });
        });

        upstream.on(
            'message',
            (data: WebSocket.RawData) => void this.onUpstreamMessage(session, upstream, current, data),
        );

        upstream.on('close', () => this.onUpstreamClosed(session, upstream));
        upstream.on('error', (err: Error) => {
            this.log.system.warn(`SnsTimelineRelayManageModel: upstream ws error (${err.message})`);
        });
    }

    /**
     * 上流から届いたメッセージを解釈し、対象の note を共通形へ変換してクライアントへ流す。
     * 生の Misskey note はそのまま渡さない。
     * **WebSocket ストリーミング経由の note には `reactionEmojis` 自体が入っていないことがある**ため、
     * REST 版のタイムライン取得 (`SnsApiModel.getTimeline`) と同じくインスタンス単位の絵文字キャッシュ
     * (`getEmojis()`、TTL 1h でキャッシュ済みなので実質ローカル参照) をリアクション絵文字解決のフォールバックに渡す
     */
    private async onUpstreamMessage(
        session: RelaySession,
        upstream: WebSocket,
        current: CurrentSubscription,
        data: WebSocket.RawData,
    ): Promise<void> {
        if (session.upstream !== upstream || session.current !== current) return;

        let parsed: any;
        try {
            parsed = JSON.parse(data.toString());
        } catch (e) {
            return;
        }
        if (parsed?.type !== 'channel' || parsed.body?.id !== current.connectId || parsed.body?.type !== 'note') {
            return;
        }

        try {
            const emojis = await this.misskeyClient.getEmojis(current.host).catch(() => []);
            // 絵文字取得を待つ間に購読が張り替えられていた場合は、古い購読分の note を送らない
            if (session.upstream !== upstream || session.current !== current) return;
            const emojiUrlByName = new Map(emojis.map(emoji => [emoji.name, emoji.url]));

            const note = convertMisskeyNoteToTimelineNote(
                current.host,
                parsed.body.body,
                name => emojiUrlByName.get(name) ?? null,
            );
            this.sendToClient(session, { type: 'note', note });
        } catch (err) {
            this.log.system.warn('SnsTimelineRelayManageModel: failed to convert upstream note');
            this.log.system.warn(err as Error);
        }
    }

    /**
     * 上流接続が切れた際の処理。意図した close (unsubscribe / セッション終了) でなければ
     * 指数バックオフで再接続する
     */
    private onUpstreamClosed(session: RelaySession, upstream: WebSocket): void {
        if (session.upstream !== upstream) return; // 既に張り替え済みの古い upstream のイベントは無視
        session.upstream = null;
        if (session.closed === true || session.current === null) return;

        const delay = this.reconnectDelayFn(session.reconnectAttempts);
        if (delay === null) {
            this.log.system.warn('SnsTimelineRelayManageModel: gave up reconnecting to misskey streaming api');
            this.sendToClient(session, { type: 'error', message: 'SnsTimelineWsReconnectGaveUp' });
            session.current = null;

            return;
        }

        session.reconnectAttempts += 1;
        session.reconnectTimer = setTimeout(() => {
            session.reconnectTimer = null;
            this.connectUpstream(session);
        }, delay);
    }

    /**
     * 上流接続 (と再接続タイマー) を閉じる。以後のイベントで再接続しないよう `current` も消す
     */
    private closeUpstream(session: RelaySession): void {
        if (session.reconnectTimer !== null) {
            clearTimeout(session.reconnectTimer);
            session.reconnectTimer = null;
        }
        session.current = null;
        session.reconnectAttempts = 0;

        const upstream = session.upstream;
        session.upstream = null;
        if (upstream !== null) {
            try {
                upstream.removeAllListeners();
                upstream.close();
            } catch (err) {
                // 既に閉じている等は無視する
            }
        }
    }

    /**
     * クライアント接続の終了処理。上流も必ず閉じてセッションを破棄する
     */
    private closeSession(session: RelaySession): void {
        if (session.closed === true) return;
        session.closed = true;
        this.closeUpstream(session);
        this.sessions.delete(session.id);
    }

    /**
     * クライアントへ JSON メッセージを送る
     */
    private sendToClient(session: RelaySession, obj: Record<string, unknown>): void {
        if (session.ws.readyState !== session.ws.OPEN) return;
        try {
            session.ws.send(JSON.stringify(obj));
        } catch (err) {
            this.log.system.warn('SnsTimelineRelayManageModel: failed to send message to client');
            this.log.system.warn(err as Error);
            this.closeSession(session);
        }
    }
}
