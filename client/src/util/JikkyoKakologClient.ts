import JikkyoCommentClient, { JikkyoComment } from './JikkyoCommentClient';

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
}

interface KakologComment extends JikkyoComment {
    timestamp: number; // UNIX 時刻 (ミリ秒)
}

export interface JikkyoKakologClientOption {
    jikkyoChannelId: string;
    startAt: number; // 録画開始時刻 (UNIX 時刻・ミリ秒)
    endAt: number; // 録画終了時刻 (UNIX 時刻・ミリ秒)
    getCurrentTime: () => number; // 動画の現在再生位置 (秒)
    onComment: (comment: JikkyoComment) => void;
    onError?: (message: string) => void;
}

/**
 * ニコニコ実況 過去ログ再生クライアント
 *
 * 過去ログ API から指定録画のコメントを取得し、動画の再生位置に同期して描画する。
 * API の一回あたりの取得上限 (3日) を超える録画では、先頭から3日分を取得する。
 */
export default class JikkyoKakologClient {
    private option: JikkyoKakologClientOption;
    private comments: KakologComment[] = [];
    private nextCommentIndex: number = 0;
    private lastPlaybackTime: number | null = null;
    private isDestroyed: boolean = false;

    private static readonly API_URL = 'https://jikkyo.tsukumijima.net/api/kakolog';
    private static readonly MAX_REQUEST_DURATION = 3 * 24 * 60 * 60 * 1000;
    private static readonly SEEK_THRESHOLD = 3;

    constructor(option: JikkyoKakologClientOption) {
        this.option = option;
    }

    /**
     * 過去ログを取得する
     */
    public async start(): Promise<void> {
        const startAt = Math.floor(this.option.startAt / 1000);
        const endAt = Math.floor(Math.min(this.option.endAt, this.option.startAt + JikkyoKakologClient.MAX_REQUEST_DURATION) / 1000);
        if (startAt >= endAt) {
            return;
        }

        const url = new URL(`${JikkyoKakologClient.API_URL}/${encodeURIComponent(this.option.jikkyoChannelId)}`);
        url.searchParams.set('starttime', startAt.toString(10));
        url.searchParams.set('endtime', endAt.toString(10));
        url.searchParams.set('format', 'json');

        try {
            const response = await fetch(url.toString());
            if (response.ok === false) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = (await response.json()) as KakologResponse;
            if (this.isDestroyed === true) {
                return;
            }

            this.comments = this.parseComments(data);
            this.seek(this.option.getCurrentTime());
            this.tick();
        } catch (err) {
            if (this.isDestroyed === false) {
                console.error('JikkyoKakologClient: failed to load kakolog', err);
                this.option.onError?.('ニコニコ実況の過去ログを取得できませんでした');
            }
        }
    }

    /**
     * 動画の再生位置が更新されたときに呼び出す
     */
    public tick(): void {
        if (this.isDestroyed === true || this.comments.length === 0) {
            return;
        }

        const playbackTime = this.option.getCurrentTime();
        if (this.lastPlaybackTime === null || Math.abs(playbackTime - this.lastPlaybackTime) > JikkyoKakologClient.SEEK_THRESHOLD) {
            // 初期表示・シーク時は、それ以前のコメントを一括描画しない
            this.seek(playbackTime);
        }
        this.lastPlaybackTime = playbackTime;

        const currentTimestamp = this.option.startAt + playbackTime * 1000;
        while (this.nextCommentIndex < this.comments.length && this.comments[this.nextCommentIndex].timestamp <= currentTimestamp) {
            this.option.onComment(this.comments[this.nextCommentIndex]);
            this.nextCommentIndex++;
        }
    }

    /**
     * 指定再生位置へコメントの読み出し位置を移動する
     */
    private seek(playbackTime: number): void {
        const targetTimestamp = this.option.startAt + playbackTime * 1000;
        let low = 0;
        let high = this.comments.length;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (this.comments[mid].timestamp < targetTimestamp) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        this.nextCommentIndex = low;
        this.lastPlaybackTime = playbackTime;
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
