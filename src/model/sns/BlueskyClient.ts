import { inject, injectable } from 'inversify';
import IProviderHttpClient from '../metadata/IProviderHttpClient';
import IBlueskyClient, {
    BlueskyApiError,
    BlueskyBlobRef,
    BlueskyCreatePostOption,
    BlueskyCreatePostResult,
    BlueskyCreateRecordResult,
    BlueskyProfile,
    BlueskyRecordCollection,
    BlueskySession,
    BlueskyTimelineOption,
    BlueskyTimelineResponse,
} from './IBlueskyClient';

interface CreateSessionResponse {
    did?: string;
    handle?: string;
    accessJwt?: string;
    refreshJwt?: string;
    error?: string;
    message?: string;
}

interface GetProfileResponse {
    did?: string;
    handle?: string;
    displayName?: string;
    avatar?: string;
    error?: string;
    message?: string;
}

interface UploadBlobResponse {
    blob?: BlueskyBlobRef;
    error?: string;
    message?: string;
}

interface CreateRecordResponse {
    uri?: string;
    cid?: string;
    error?: string;
    message?: string;
}

interface DeleteRecordResponse {
    error?: string;
    message?: string;
}

/**
 * Bluesky (AT Protocol) の XRPC を薄くラップするクライアント。
 * SDK (`@atproto/api`) は使わず自前で叩く (App Password のセッション管理と
 * 失効時の再ログインをこちら側で完全に制御するため)
 */
@injectable()
export default class BlueskyClient implements IBlueskyClient {
    private static readonly DEFAULT_SERVICE = 'bsky.social';
    private static readonly UPLOAD_TIMEOUT_MS = 30 * 1000;
    private static readonly TIMELINE_DEFAULT_LIMIT = 20;
    private static readonly TIMELINE_MAX_LIMIT = 50;

    constructor(@inject('IProviderHttpClient') private readonly http: IProviderHttpClient) {}

    public async login(identifier: string, appPassword: string, service?: string): Promise<BlueskySession> {
        const normalizedIdentifier = identifier.trim().replace(/^@/, '');
        const response = await this.http.post(
            this.xrpcUrl(service, 'com.atproto.server.createSession'),
            JSON.stringify({ identifier: normalizedIdentifier, password: appPassword }),
            { headers: { 'content-type': 'application/json' } },
        );

        return this.toSession(response.status, response.json<CreateSessionResponse>());
    }

    public async refresh(refreshJwt: string, service?: string): Promise<BlueskySession> {
        const response = await this.http.post(this.xrpcUrl(service, 'com.atproto.server.refreshSession'), '', {
            headers: { Authorization: `Bearer ${refreshJwt}` },
        });

        return this.toSession(response.status, response.json<CreateSessionResponse>());
    }

    public async getProfile(accessJwt: string, actor: string, service?: string): Promise<BlueskyProfile> {
        const url = `${this.xrpcUrl(service, 'app.bsky.actor.getProfile')}?actor=${encodeURIComponent(actor)}`;
        const response = await this.http.get(url, { headers: { Authorization: `Bearer ${accessJwt}` } });
        const body = response.json<GetProfileResponse>();
        this.throwIfError(response.status, body);

        return {
            did: body.did ?? actor,
            handle: body.handle ?? actor,
            displayName: typeof body.displayName === 'string' && body.displayName !== '' ? body.displayName : null,
            avatarUrl: typeof body.avatar === 'string' && body.avatar !== '' ? body.avatar : null,
        };
    }

    /**
     * 画像を blob としてアップロードする。
     * バイナリ body を送るため `IProviderHttpClient` (text/json 専用) は使わず素の fetch を使う
     * (`src/model/auth/OAuthModel.ts` の fetch + AbortController パターンに倣う)
     */
    public async uploadBlob(
        accessJwt: string,
        buffer: Buffer,
        mimeType: string,
        service?: string,
    ): Promise<BlueskyBlobRef> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), BlueskyClient.UPLOAD_TIMEOUT_MS);
        try {
            const response = await fetch(this.xrpcUrl(service, 'com.atproto.repo.uploadBlob'), {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessJwt}`,
                    'content-type': mimeType,
                },
                body: new Uint8Array(buffer),
                signal: controller.signal,
            });
            const text = await response.text();
            const body: UploadBlobResponse = text === '' ? {} : JSON.parse(text);
            this.throwIfError(response.status, body);
            if (typeof body.blob === 'undefined') {
                throw new BlueskyApiError(response.status, 'uploadBlob response did not contain a blob');
            }

            return body.blob;
        } finally {
            clearTimeout(timer);
        }
    }

    public async createPost(
        accessJwt: string,
        did: string,
        option: BlueskyCreatePostOption,
        service?: string,
    ): Promise<BlueskyCreatePostResult> {
        const record: Record<string, unknown> = {
            $type: 'app.bsky.feed.post',
            text: option.text,
            createdAt: new Date().toISOString(),
        };
        if (option.facets.length > 0) record.facets = option.facets;
        if (option.images.length > 0) {
            record.embed = {
                $type: 'app.bsky.embed.images',
                images: option.images.map(image => ({ image: image.blob, alt: image.alt })),
            };
        }

        const response = await this.http.post(
            this.xrpcUrl(service, 'com.atproto.repo.createRecord'),
            JSON.stringify({ repo: did, collection: 'app.bsky.feed.post', record }),
            { headers: { Authorization: `Bearer ${accessJwt}`, 'content-type': 'application/json' } },
        );
        const body = response.json<CreateRecordResponse>();
        this.throwIfError(response.status, body);
        if (typeof body.uri !== 'string' || typeof body.cid !== 'string') {
            throw new BlueskyApiError(response.status, 'createRecord response did not contain uri/cid');
        }

        return { uri: body.uri, cid: body.cid };
    }

    public async getTimeline(
        accessJwt: string,
        option: BlueskyTimelineOption,
        service?: string,
    ): Promise<BlueskyTimelineResponse> {
        const limit = Math.min(
            Math.max(option.limit ?? BlueskyClient.TIMELINE_DEFAULT_LIMIT, 1),
            BlueskyClient.TIMELINE_MAX_LIMIT,
        );
        const params = new URLSearchParams({ limit: String(limit) });
        if (typeof option.cursor === 'string' && option.cursor !== '') params.set('cursor', option.cursor);

        const url = `${this.xrpcUrl(service, 'app.bsky.feed.getTimeline')}?${params.toString()}`;
        const response = await this.http.get(url, { headers: { Authorization: `Bearer ${accessJwt}` } });
        const body = response.json<BlueskyTimelineResponse & { error?: string; message?: string }>();
        this.throwIfError(response.status, body);

        return { feed: Array.isArray(body.feed) ? body.feed : [], cursor: body.cursor };
    }

    public async like(
        accessJwt: string,
        did: string,
        uri: string,
        cid: string,
        service?: string,
    ): Promise<BlueskyCreateRecordResult> {
        return this.createRecord(
            accessJwt,
            did,
            'app.bsky.feed.like',
            { $type: 'app.bsky.feed.like', subject: { uri, cid }, createdAt: new Date().toISOString() },
            service,
        );
    }

    public async deleteLike(accessJwt: string, did: string, rkey: string, service?: string): Promise<void> {
        await this.deleteRecord(accessJwt, did, 'app.bsky.feed.like', rkey, service);
    }

    public async repost(
        accessJwt: string,
        did: string,
        uri: string,
        cid: string,
        service?: string,
    ): Promise<BlueskyCreateRecordResult> {
        return this.createRecord(
            accessJwt,
            did,
            'app.bsky.feed.repost',
            { $type: 'app.bsky.feed.repost', subject: { uri, cid }, createdAt: new Date().toISOString() },
            service,
        );
    }

    public async deleteRepost(accessJwt: string, did: string, rkey: string, service?: string): Promise<void> {
        await this.deleteRecord(accessJwt, did, 'app.bsky.feed.repost', rkey, service);
    }

    /**
     * like / repost に共通の createRecord 呼び出し
     */
    private async createRecord(
        accessJwt: string,
        did: string,
        collection: BlueskyRecordCollection,
        record: Record<string, unknown>,
        service?: string,
    ): Promise<BlueskyCreateRecordResult> {
        const response = await this.http.post(
            this.xrpcUrl(service, 'com.atproto.repo.createRecord'),
            JSON.stringify({ repo: did, collection, record }),
            { headers: { Authorization: `Bearer ${accessJwt}`, 'content-type': 'application/json' } },
        );
        const body = response.json<CreateRecordResponse>();
        this.throwIfError(response.status, body);
        if (typeof body.uri !== 'string') {
            throw new BlueskyApiError(response.status, `createRecord (${collection}) response did not contain uri`);
        }

        return { uri: body.uri };
    }

    /**
     * like / repost の取り消しに共通の deleteRecord 呼び出し
     */
    private async deleteRecord(
        accessJwt: string,
        did: string,
        collection: BlueskyRecordCollection,
        rkey: string,
        service?: string,
    ): Promise<void> {
        const response = await this.http.post(
            this.xrpcUrl(service, 'com.atproto.repo.deleteRecord'),
            JSON.stringify({ repo: did, collection, rkey }),
            { headers: { Authorization: `Bearer ${accessJwt}`, 'content-type': 'application/json' } },
        );
        const body = response.json<DeleteRecordResponse>();
        this.throwIfError(response.status, body);
    }

    private xrpcUrl(service: string | undefined, method: string): string {
        const host = typeof service === 'string' && service !== '' ? service : BlueskyClient.DEFAULT_SERVICE;

        return `https://${host}/xrpc/${method}`;
    }

    private toSession(status: number, body: CreateSessionResponse): BlueskySession {
        this.throwIfError(status, body);
        if (
            typeof body.did !== 'string' ||
            typeof body.handle !== 'string' ||
            typeof body.accessJwt !== 'string' ||
            typeof body.refreshJwt !== 'string'
        ) {
            throw new BlueskyApiError(status, 'session response is missing required fields');
        }

        return { did: body.did, handle: body.handle, accessJwt: body.accessJwt, refreshJwt: body.refreshJwt };
    }

    private throwIfError(status: number, body: { error?: string; message?: string }): void {
        if (status >= 200 && status < 300) return;
        const detail =
            typeof body.message === 'string' && body.message !== ''
                ? body.message
                : (body.error ?? `unexpected status ${status}`);
        throw new BlueskyApiError(status, detail);
    }
}
