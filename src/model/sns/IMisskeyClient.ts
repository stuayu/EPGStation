export interface MisskeyUser {
    id: string;
    username: string;
    name: string | null;
    avatarUrl: string | null;
    host: string | null;
}

export interface MisskeyChannel {
    id: string;
    name: string;
}

export interface MisskeyCreateNoteOption {
    text: string;
    visibility: 'public' | 'home' | 'followers' | 'specified';
    localOnly: boolean;
    // 指定するとチャンネルへの投稿になる (visibility は 'public' に強制される)
    channelId?: string | null;
    fileIds: string[];
    cw?: string | null;
}

export interface MisskeyCreateNoteResult {
    id: string;
    // Web UI で開くための URL (host から組み立てる)
    url: string;
}

export interface MisskeyAuthCheckResult {
    ok: boolean;
    token: string;
    user: MisskeyUser;
}

export interface MisskeyEmoji {
    name: string;
    url: string;
    category: string | null;
    aliases: string[];
}

export type MisskeyTimelineType = 'home' | 'social' | 'local' | 'channel';

export interface MisskeyTimelineOption {
    type: MisskeyTimelineType;
    // type が 'channel' のとき必須
    channelId?: string;
    // 既定 20、上限 50
    limit?: number;
    // ページング用 (前回取得した最後のノート id)
    untilId?: string;
}

export interface MisskeyNoteFile {
    url: string | null;
    thumbnailUrl: string | null;
    isSensitive: boolean;
}

export interface MisskeyNote {
    id: string;
    // ISO8601
    createdAt: string;
    text: string | null;
    cw: string | null;
    user: MisskeyUser;
    files: MisskeyNoteFile[];
    // key: リアクション文字列 ('👍' や ':name@host:' 形式), value: 件数
    reactions: Record<string, number>;
    // カスタム絵文字リアクションの名前 (コロン抜き) → 画像 URL
    reactionEmojis: Record<string, string>;
    // 自分が付けているリアクション。無ければ null
    myReaction: string | null;
    renoteCount: number;
    // 本文もファイルも持たない「純粋なリノート」の場合、参照先のノートが入る
    renote?: MisskeyNote | null;
}

/**
 * Misskey API がエラー ({"error": {"code": "...", "message": "..."}}) を返した際にスローされる
 */
export class MisskeyApiError extends Error {
    public readonly status: number;
    public readonly code: string;
    public readonly detail: string;
    constructor(status: number, code: string, detail: string) {
        super(`MisskeyApiError: ${status} ${code} ${detail}`);
        this.name = 'MisskeyApiError';
        this.status = status;
        this.code = code;
        this.detail = detail;
    }
}

export default interface IMisskeyClient {
    /**
     * ユーザーが入力したインスタンス URL / ホスト名をホスト名のみへ正規化する
     * (KonomiTV `server/app/utils/MisskeyAPI.py:250-266` 相当)
     * @param input: string
     * @return string
     */
    normalizeInstanceUrl(input: string): string;
    /**
     * アクセストークンで自分自身の情報を取得する
     * @param host: string
     * @param token: string
     * @return Promise<MisskeyUser>
     */
    getMe(host: string, token: string): Promise<MisskeyUser>;
    /**
     * ノートを投稿する
     * @param host: string
     * @param token: string
     * @param option: MisskeyCreateNoteOption
     * @return Promise<MisskeyCreateNoteResult>
     */
    createNote(host: string, token: string, option: MisskeyCreateNoteOption): Promise<MisskeyCreateNoteResult>;
    /**
     * ドライブへファイルをアップロードする
     * @param host: string
     * @param token: string
     * @param buffer: Buffer
     * @param filename: string
     * @param mimeType: string アップロードする画像の MIME type (`image/jpeg` 等)
     * @param folderId?: string
     * @return Promise<string> ファイル id
     */
    uploadFile(
        host: string,
        token: string,
        buffer: Buffer,
        filename: string,
        mimeType: string,
        folderId?: string,
    ): Promise<string>;
    /**
     * フォロー中 + 自分が作成したチャンネルの一覧を取得する (設定画面のチャンネル選択用)
     * @param host: string
     * @param token: string
     * @return Promise<MisskeyChannel[]>
     */
    getChannels(host: string, token: string): Promise<MisskeyChannel[]>;
    /**
     * MiAuth のセッションを検証してアクセストークンを発行する
     * @param host: string
     * @param sessionId: string
     * @return Promise<MisskeyAuthCheckResult>
     */
    checkAuth(host: string, sessionId: string): Promise<MisskeyAuthCheckResult>;
    /**
     * カスタム絵文字一覧を取得する (認証不要)。
     * インスタンス単位でサーバー側にメモリキャッシュする (既定 TTL 1 時間)
     * @param host: string
     * @param now?: number テスト用に現在時刻を差し替え可能にする
     * @return Promise<MisskeyEmoji[]>
     */
    getEmojis(host: string, now?: number): Promise<MisskeyEmoji[]>;
    /**
     * タイムラインを取得する
     * @param host: string
     * @param token: string
     * @param option: MisskeyTimelineOption
     * @return Promise<MisskeyNote[]>
     */
    getTimeline(host: string, token: string, option: MisskeyTimelineOption): Promise<MisskeyNote[]>;
    /**
     * ノートへリアクションを付ける
     * @param host: string
     * @param token: string
     * @param noteId: string
     * @param reaction: string '👍' のような Unicode か ':custom_emoji:' 形式
     * @return Promise<void>
     */
    createReaction(host: string, token: string, noteId: string, reaction: string): Promise<void>;
    /**
     * 自分が付けたリアクションを取り消す
     * @param host: string
     * @param token: string
     * @param noteId: string
     * @return Promise<void>
     */
    deleteReaction(host: string, token: string, noteId: string): Promise<void>;
    /**
     * ノートをリノートする (本文なし)
     * @param host: string
     * @param token: string
     * @param noteId: string
     * @return Promise<MisskeyCreateNoteResult>
     */
    renote(host: string, token: string, noteId: string): Promise<MisskeyCreateNoteResult>;
}
