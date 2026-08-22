import { BlueskyFacet } from './BlueskyFacetUtil';

export interface BlueskySession {
    did: string;
    handle: string;
    accessJwt: string;
    refreshJwt: string;
}

export interface BlueskyProfile {
    did: string;
    handle: string;
    displayName: string | null;
    avatarUrl: string | null;
}

export interface BlueskyBlobRef {
    $type: 'blob';
    ref: { $link: string };
    mimeType: string;
    size: number;
}

export interface BlueskyPostImage {
    blob: BlueskyBlobRef;
    alt: string;
}

export interface BlueskyCreatePostOption {
    text: string;
    facets: BlueskyFacet[];
    images: BlueskyPostImage[];
}

export interface BlueskyCreatePostResult {
    uri: string;
    cid: string;
}

export interface BlueskyTimelineAuthor {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
}

export interface BlueskyTimelineImageView {
    thumb?: string;
    fullsize?: string;
    alt?: string;
}

export interface BlueskyTimelinePostRecord {
    text?: string;
    createdAt?: string;
}

export interface BlueskyTimelinePostViewer {
    // like レコードの at-uri (自分が like している場合のみ)
    like?: string;
    // repost レコードの at-uri (自分が repost している場合のみ)
    repost?: string;
}

export interface BlueskyTimelinePostEmbed {
    $type?: string;
    images?: BlueskyTimelineImageView[];
    // recordWithMedia の場合、実体の画像は media 側に入る
    media?: BlueskyTimelinePostEmbed;
}

export interface BlueskyTimelinePost {
    uri: string;
    cid: string;
    author: BlueskyTimelineAuthor;
    record?: BlueskyTimelinePostRecord;
    embed?: BlueskyTimelinePostEmbed;
    likeCount?: number;
    repostCount?: number;
    indexedAt?: string;
    viewer?: BlueskyTimelinePostViewer;
    labels?: { val?: string }[];
}

export interface BlueskyFeedViewPost {
    post: BlueskyTimelinePost;
}

export interface BlueskyTimelineResponse {
    feed: BlueskyFeedViewPost[];
    cursor?: string;
}

export interface BlueskyTimelineOption {
    // 既定 20、上限 50
    limit?: number;
    cursor?: string;
}

export type BlueskyRecordCollection = 'app.bsky.feed.like' | 'app.bsky.feed.repost';

export interface BlueskyCreateRecordResult {
    uri: string;
}

/**
 * Bluesky (AT Protocol) API が 4xx を返した際にスローされるエラー。
 * 401 (アクセストークン失効) だけを特別扱いして再ログインするために status を持たせる
 */
export class BlueskyApiError extends Error {
    public readonly status: number;
    public readonly detail: string;
    constructor(status: number, detail: string) {
        super(`BlueskyApiError: ${status} ${detail}`);
        this.name = 'BlueskyApiError';
        this.status = status;
        this.detail = detail;
    }
}

export default interface IBlueskyClient {
    /**
     * App Password でログインしてセッションを発行する
     * @param identifier: string ハンドル or メールアドレス (先頭の '@' は自動で除去する)
     * @param appPassword: string
     * @param service?: string PDS ホスト (既定 bsky.social)
     * @return Promise<BlueskySession>
     */
    login(identifier: string, appPassword: string, service?: string): Promise<BlueskySession>;
    /**
     * refreshJwt でセッションを更新する
     * @param refreshJwt: string
     * @param service?: string PDS ホスト
     * @return Promise<BlueskySession>
     */
    refresh(refreshJwt: string, service?: string): Promise<BlueskySession>;
    /**
     * プロフィール (表示名・アバター) を取得する
     * @param accessJwt: string
     * @param actor: string DID or ハンドル
     * @param service?: string PDS ホスト
     * @return Promise<BlueskyProfile>
     */
    getProfile(accessJwt: string, actor: string, service?: string): Promise<BlueskyProfile>;
    /**
     * 画像を blob としてアップロードする (2MB 上限は呼び出し側で確認する)
     * @param accessJwt: string
     * @param buffer: Buffer
     * @param mimeType: string
     * @param service?: string PDS ホスト
     * @return Promise<BlueskyBlobRef>
     */
    uploadBlob(accessJwt: string, buffer: Buffer, mimeType: string, service?: string): Promise<BlueskyBlobRef>;
    /**
     * 投稿を作成する
     * @param accessJwt: string
     * @param did: string
     * @param option: BlueskyCreatePostOption
     * @param service?: string PDS ホスト
     * @return Promise<BlueskyCreatePostResult>
     */
    createPost(
        accessJwt: string,
        did: string,
        option: BlueskyCreatePostOption,
        service?: string,
    ): Promise<BlueskyCreatePostResult>;
    /**
     * タイムライン (フォロー中のフィード) を取得する
     * @param accessJwt: string
     * @param option: BlueskyTimelineOption
     * @param service?: string PDS ホスト
     * @return Promise<BlueskyTimelineResponse>
     */
    getTimeline(accessJwt: string, option: BlueskyTimelineOption, service?: string): Promise<BlueskyTimelineResponse>;
    /**
     * 投稿へ like を付ける
     * @param accessJwt: string
     * @param did: string
     * @param uri: string like 対象の投稿の at-uri
     * @param cid: string like 対象の投稿の cid
     * @param service?: string PDS ホスト
     * @return Promise<BlueskyCreateRecordResult> 作成した like レコード自体の at-uri (取り消し時の rkey 抽出に使う)
     */
    like(
        accessJwt: string,
        did: string,
        uri: string,
        cid: string,
        service?: string,
    ): Promise<BlueskyCreateRecordResult>;
    /**
     * like を取り消す
     * @param accessJwt: string
     * @param did: string
     * @param rkey: string `like()` が返した at-uri から抽出した rkey
     * @param service?: string PDS ホスト
     * @return Promise<void>
     */
    deleteLike(accessJwt: string, did: string, rkey: string, service?: string): Promise<void>;
    /**
     * 投稿を repost する
     * @param accessJwt: string
     * @param did: string
     * @param uri: string repost 対象の投稿の at-uri
     * @param cid: string repost 対象の投稿の cid
     * @param service?: string PDS ホスト
     * @return Promise<BlueskyCreateRecordResult> 作成した repost レコード自体の at-uri
     */
    repost(
        accessJwt: string,
        did: string,
        uri: string,
        cid: string,
        service?: string,
    ): Promise<BlueskyCreateRecordResult>;
    /**
     * repost を取り消す
     * @param accessJwt: string
     * @param did: string
     * @param rkey: string `repost()` が返した at-uri から抽出した rkey
     * @param service?: string PDS ホスト
     * @return Promise<void>
     */
    deleteRepost(accessJwt: string, did: string, rkey: string, service?: string): Promise<void>;
}
