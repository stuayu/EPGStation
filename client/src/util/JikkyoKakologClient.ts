import JikkyoCommentClient, { JikkyoComment } from './JikkyoCommentClient';
import {
    findRecordedJikkyoCommentIndex,
    resolveRecordedJikkyoTimestamp,
} from '../../../src/util/RecordedJikkyoSync';

/**
 * ニコニコ実況過去ログ API のレスポンス形式
 */
interface KakologResponse {
    packet?: Array<{
        chat?: {
            date?: string | number;
            date_usec?: string | number;
            mail?: string;
            content?: string;
        };
    }>;
    error?: string;
}

interface KakologComment extends JikkyoComment {
    timestamp: number; // UNIX 時刻 (ミリ秒)
}

export interface JikkyoKakologClientOption {
    jikkyoChannelId: string;
    startAt: number; // 録画開始時刻 (UNIX 時刻・ミリ秒)
    endAt: number; // 録画終了時刻 (UNIX 時刻・ミリ秒)
    getCurrentTime: () => number | null; // VirtualTimeline 上の絶対再生位置 (秒)。再生成中は null
    onComment: (comment: JikkyoComment) => void;
    onError?: (message: string) => void;
}

/**
 * ニコニコ実況 過去ログ再生クライアント
 *
 * 過去ログ API から指定録画のコメントを取得し、動画の再生位置に同期して描画する。
 * API の一回あたりの取得上限 (3日) を超える録画では、期間を分割して順次取得する。
 * 最初のチャンクを取得した時点で描画を開始し、残りはバックグラウンドで追加していく。
 */
export default class JikkyoKakologClient {
    private option: JikkyoKakologClientOption;
    private comments: KakologComment[] = [];
    private nextCommentIndex: number = 0;
    private lastPlaybackTime: number | null = null;
    private isDestroyed: boolean = false;
    private isLoading = false;
    private nextRequestStartAt: number;

    private static readonly API_URL = 'https://jikkyo.tsukumijima.net/api/kakolog';
    private static readonly MAX_REQUEST_DURATION = 3 * 24 * 60 * 60 * 1000;
    private static readonly MAX_REQUEST_COUNT = 16;
    private static readonly SEEK_THRESHOLD = 3;

    constructor(option: JikkyoKakologClientOption) {
        this.option = option;
        this.nextRequestStartAt = option.startAt;
    }

    /**
     * 過去ログを取得する
     */
    public async start(): Promise<void> {
        if (this.nextRequestStartAt >= this.option.endAt || this.isLoading === true) {
            return;
        }

        this.isLoading = true;

        let hasComment = false;
        let hasError = false;
        let requestCount = 0;
        let chunkStartAt = this.nextRequestStartAt;

        while (chunkStartAt < this.option.endAt && requestCount < JikkyoKakologClient.MAX_REQUEST_COUNT) {
            if (this.isDestroyedNow() === true) {
                return;
            }

            const chunkEndAt = Math.min(chunkStartAt + JikkyoKakologClient.MAX_REQUEST_DURATION, this.option.endAt);
            requestCount++;

            let chunkComments: KakologComment[] | null = null;
            try {
                chunkComments = await this.fetchComments(chunkStartAt, chunkEndAt);
            } catch (err) {
                if (this.isDestroyedNow() === true) {
                    return;
                }
                console.error('JikkyoKakologClient: failed to load kakolog', err);
                hasError = true;
                break;
            }

            if (this.isDestroyedNow() === true) {
                return;
            }

            if (chunkComments.length > 0) {
                hasComment = true;
                this.addComments(chunkComments);
            }

            chunkStartAt = chunkEndAt;
            this.nextRequestStartAt = chunkEndAt;
        }

        this.isLoading = false;

        if (hasError === true && hasComment === false) {
            this.option.onError?.('ニコニコ実況の過去ログを取得できませんでした');
        } else if (hasComment === false) {
            this.option.onError?.('この番組のニコニコ実況過去ログは見つかりませんでした');
        }
    }

    /** 回線復帰時に失敗した未取得区間の取得を再開する。 */
    public retry(): void {
        if (this.isDestroyedNow() === false) void this.start();
    }

    /**
     * 指定区間の過去ログを取得する
     * @param startAt: number 取得開始時刻 (UNIX 時刻・ミリ秒)
     * @param endAt: number 取得終了時刻 (UNIX 時刻・ミリ秒)
     * @return Promise<KakologComment[]>
     */
    private async fetchComments(startAt: number, endAt: number): Promise<KakologComment[]> {
        const url = new URL(`${JikkyoKakologClient.API_URL}/${encodeURIComponent(this.option.jikkyoChannelId)}`);
        url.searchParams.set('starttime', Math.floor(startAt / 1000).toString(10));
        url.searchParams.set('endtime', Math.floor(endAt / 1000).toString(10));
        url.searchParams.set('format', 'json');

        const response = await fetch(url.toString());
        if (response.ok === false) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = (await response.json()) as KakologResponse;
        if (typeof data.error === 'string' && data.error.length > 0) {
            throw new Error(data.error);
        }

        return this.parseComments(data);
    }

    /**
     * 取得済みコメントをマージし、現在の再生位置に同期させる
     */
    private addComments(comments: KakologComment[]): void {
        const existing = new Set(this.comments.map(comment => `${comment.timestamp}\u0000${comment.text}\u0000${comment.color}\u0000${comment.type}\u0000${comment.size}`));
        this.comments = this.comments
            .concat(comments.filter(comment => {
                const key = `${comment.timestamp}\u0000${comment.text}\u0000${comment.color}\u0000${comment.type}\u0000${comment.size}`;
                if (existing.has(key)) return false;
                existing.add(key);
                return true;
            }))
            .sort((a, b) => a.timestamp - b.timestamp);
        this.sync();
    }

    /**
     * 動画の再生位置が更新されたときに呼び出す
     */
    public tick(): void {
        if (this.isDestroyedNow() === true || this.comments.length === 0) {
            return;
        }

        const playbackTime = this.option.getCurrentTime();
        if (playbackTime === null) {
            return;
        }
        this.drawCommentsAt(playbackTime);
    }

    /**
     * 明示的に確定した録画再生位置へコメントの読み出し位置を移動する
     * @param playbackTime VirtualTimeline 上の絶対再生位置 (秒)。省略時は現在位置
     */
    public sync(playbackTime: number | null = this.option.getCurrentTime()): void {
        if (
            this.isDestroyedNow() === true ||
            this.comments.length === 0 ||
            playbackTime === null ||
            resolveRecordedJikkyoTimestamp(this.option.startAt, playbackTime) === null
        ) {
            return;
        }

        this.seek(playbackTime);
        this.drawCommentsAt(playbackTime);
    }

    /** 指定位置のコメントを読み出す */
    private drawCommentsAt(playbackTime: number): void {
        const currentTimestamp = resolveRecordedJikkyoTimestamp(this.option.startAt, playbackTime);
        if (currentTimestamp === null) {
            return;
        }

        if (this.lastPlaybackTime === null || Math.abs(playbackTime - this.lastPlaybackTime) > JikkyoKakologClient.SEEK_THRESHOLD) {
            // 初期表示・シーク時は、それ以前のコメントを一括描画しない
            this.seek(playbackTime);
        }
        this.lastPlaybackTime = playbackTime;

        while (this.nextCommentIndex < this.comments.length && this.comments[this.nextCommentIndex].timestamp <= currentTimestamp) {
            this.option.onComment(this.comments[this.nextCommentIndex]);
            this.nextCommentIndex++;
        }
    }

    /**
     * 指定再生位置へコメントの読み出し位置を移動する
     */
    private seek(playbackTime: number): void {
        this.nextCommentIndex = findRecordedJikkyoCommentIndex(this.comments, this.option.startAt, playbackTime);
        this.lastPlaybackTime = playbackTime;
    }

    /**
     * 破棄済みかを返す (await を跨いだ判定で型の絞り込みを避けるためメソッド経由で参照する)
     */
    private isDestroyedNow(): boolean {
        return this.isDestroyed;
    }

    /**
     * 非同期取得済みのコメントを破棄する
     */
    public destroy(): void {
        this.isDestroyed = true;
        this.comments = [];
    }

    /**
     * 過去ログ API のレスポンスを描画用コメントに変換する
     */
    private parseComments(data: KakologResponse): KakologComment[] {
        if (Array.isArray(data.packet) === false) {
            return [];
        }

        const comments: KakologComment[] = [];
        for (const packet of data.packet) {
            const chat = packet.chat;
            const content = chat?.content;
            const date = Number(chat?.date);
            if (typeof content !== 'string' || content.length === 0 || content.startsWith('/') === true || Number.isFinite(date) === false) {
                continue;
            }

            const dateUsec = Number(chat?.date_usec ?? 0);
            const command = JikkyoCommentClient.parseCommand(chat?.mail);
            comments.push({
                text: content,
                color: command.color,
                type: command.type,
                size: command.size,
                timestamp: date * 1000 + Math.floor(dateUsec / 1000),
            });
        }

        return comments.sort((a, b) => a.timestamp - b.timestamp);
    }
}
