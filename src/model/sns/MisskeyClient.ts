import { inject, injectable } from 'inversify';
import IProviderHttpClient from '../metadata/IProviderHttpClient';
import IMisskeyClient, {
    MisskeyApiError,
    MisskeyAuthCheckResult,
    MisskeyChannel,
    MisskeyCreateNoteOption,
    MisskeyCreateNoteResult,
    MisskeyEmoji,
    MisskeyNote,
    MisskeyNoteFile,
    MisskeyTimelineOption,
    MisskeyUser,
} from './IMisskeyClient';

interface MisskeyErrorBody {
    error?: { code?: string; message?: string; id?: string };
}

interface RawMisskeyUser {
    id?: string;
    username?: string;
    name?: string | null;
    avatarUrl?: string | null;
    host?: string | null;
}

interface RawMisskeyChannel {
    id?: string;
    name?: string;
}

interface RawMisskeyNote {
    // /api/notes/create の実際の応答は id を直下ではなく createdNote の下に入れて返す
    // (`noCreatedNote: true` を明示的に渡した場合のみ createdNote が省略される)。
    // フラットな id もあれば拾えるよう両対応にしておく
    id?: string;
    createdNote?: { id?: string };
}

interface RawMisskeyDriveFile {
    id?: string;
}

interface RawMiAuthCheckResponse {
    ok?: boolean;
    token?: string;
    user?: RawMisskeyUser;
}

interface RawMisskeyEmoji {
    name?: string;
    url?: string;
    category?: string | null;
    aliases?: string[];
}

interface RawMisskeyNoteFile {
    url?: string | null;
    thumbnailUrl?: string | null;
    isSensitive?: boolean;
}

interface RawMisskeyNoteBody {
    id?: string;
    createdAt?: string;
    text?: string | null;
    cw?: string | null;
    user?: RawMisskeyUser;
    files?: RawMisskeyNoteFile[];
    reactions?: Record<string, number>;
    reactionEmojis?: Record<string, string>;
    myReaction?: string | null;
    renoteCount?: number;
    renote?: RawMisskeyNoteBody | null;
}

/**
 * Misskey REST API を薄くラップするクライアント。
 * すべてのエンドポイントは POST で、認証はボディの `i` (アクセストークン) で行う
 */
@injectable()
export default class MisskeyClient implements IMisskeyClient {
    private static readonly UPLOAD_TIMEOUT_MS = 30 * 1000;
    // カスタム絵文字一覧のキャッシュ TTL (インスタンスによっては数千件返るため)
    private static readonly EMOJI_CACHE_TTL_MS = 60 * 60 * 1000;
    // タイムライン取得の limit の既定値 / 上限
    private static readonly TIMELINE_DEFAULT_LIMIT = 20;
    private static readonly TIMELINE_MAX_LIMIT = 50;

    // host ごとのカスタム絵文字キャッシュ
    private emojiCache: Map<string, { emojis: MisskeyEmoji[]; expiresAt: number }> = new Map();

    constructor(@inject('IProviderHttpClient') private readonly http: IProviderHttpClient) {}

    public normalizeInstanceUrl(input: string): string {
        let normalized = input.trim();
        for (const prefix of ['https://', 'http://']) {
            if (normalized.toLowerCase().startsWith(prefix)) {
                normalized = normalized.slice(prefix.length);
                break;
            }
        }
        normalized = normalized.split('/')[0].split('?')[0].split('#')[0].trim();

        return normalized.toLowerCase();
    }

    public async getMe(host: string, token: string): Promise<MisskeyUser> {
        const body = await this.post<RawMisskeyUser>(host, '/api/i', { i: token });

        return this.toUser(body);
    }

    public async createNote(
        host: string,
        token: string,
        option: MisskeyCreateNoteOption,
    ): Promise<MisskeyCreateNoteResult> {
        const text = option.text.trim();
        if (text === '' && option.fileIds.length === 0) {
            throw new Error('MisskeyPostContentIsEmpty');
        }

        // Misskey は null 不可のフィールドへ null を送ると INVALID_PARAM になるため、
        // 必要なキーだけを組み立てる
        const payload: Record<string, unknown> = { visibility: option.visibility };
        if (text !== '') payload.text = text;
        if (option.fileIds.length > 0) payload.fileIds = option.fileIds;
        if (option.localOnly === true) payload.localOnly = true;
        if (typeof option.cw === 'string' && option.cw !== '') payload.cw = option.cw;
        if (typeof option.channelId === 'string' && option.channelId !== '') {
            // チャンネルへの投稿は visibility を必ず 'public' にする必要がある
            // (KonomiTV server/app/utils/MisskeyAPI.py:410-413 と同じ仕様)
            payload.channelId = option.channelId;
            payload.visibility = 'public';
        }

        const body = await this.post<RawMisskeyNote>(host, '/api/notes/create', { i: token, ...payload });
        const noteId = this.extractNoteId(body);

        return { id: noteId, url: `https://${host}/notes/${noteId}` };
    }

    public async uploadFile(
        host: string,
        token: string,
        buffer: Buffer,
        filename: string,
        mimeType: string,
        folderId?: string,
    ): Promise<string> {
        const form = new FormData();
        form.append('i', token);
        // MIME type 未指定の Blob は application/octet-stream として送られる。Misskey 本体は内容から
        // 種別を判定するため実害は確認できていないが (実機の misskey.io で application/octet-stream の
        // まま送っても画像として受理された)、multipart のパート Content-Type としては誤りなので
        // 呼び出し元 (data URL) から取り出した実際の MIME type を渡す
        form.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);
        if (typeof folderId === 'string' && folderId !== '') form.append('folderId', folderId);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), MisskeyClient.UPLOAD_TIMEOUT_MS);
        try {
            const response = await fetch(`https://${host}/api/drive/files/create`, {
                method: 'POST',
                body: form,
                signal: controller.signal,
            });
            const text = await response.text();
            const parsed: RawMisskeyDriveFile & MisskeyErrorBody = text === '' ? {} : JSON.parse(text);
            this.throwIfError(response.status, parsed);
            if (typeof parsed.id !== 'string') {
                throw new MisskeyApiError(response.status, 'invalid_response', 'uploaded file id is missing');
            }

            return parsed.id;
        } finally {
            clearTimeout(timer);
        }
    }

    public async getChannels(host: string, token: string): Promise<MisskeyChannel[]> {
        const [followed, owned] = await Promise.all([
            this.post<RawMisskeyChannel[]>(host, '/api/channels/followed', { i: token }),
            this.post<RawMisskeyChannel[]>(host, '/api/channels/owned', { i: token }),
        ]);

        const merged = new Map<string, MisskeyChannel>();
        for (const raw of [...followed, ...owned]) {
            if (typeof raw.id !== 'string' || typeof raw.name !== 'string') continue;
            merged.set(raw.id, { id: raw.id, name: raw.name });
        }

        return [...merged.values()];
    }

    public async checkAuth(host: string, sessionId: string): Promise<MisskeyAuthCheckResult> {
        const body = await this.post<RawMiAuthCheckResponse>(host, `/api/miauth/${sessionId}/check`, {});
        if (body.ok !== true || typeof body.token !== 'string' || typeof body.user === 'undefined') {
            throw new MisskeyApiError(200, 'miauth_check_failed', 'MiAuth session was not approved');
        }

        return { ok: true, token: body.token, user: this.toUser(body.user) };
    }

    public async getEmojis(host: string, now: number = Date.now()): Promise<MisskeyEmoji[]> {
        const cached = this.emojiCache.get(host);
        if (typeof cached !== 'undefined' && cached.expiresAt > now) {
            return cached.emojis;
        }

        const body = await this.get<{ emojis?: RawMisskeyEmoji[] }>(host, '/api/emojis');
        const emojis = (body.emojis ?? [])
            .filter((raw): raw is Required<Pick<RawMisskeyEmoji, 'name' | 'url'>> & RawMisskeyEmoji => {
                return typeof raw.name === 'string' && typeof raw.url === 'string';
            })
            .map(raw => ({
                name: raw.name,
                url: raw.url,
                category: typeof raw.category === 'string' && raw.category !== '' ? raw.category : null,
                aliases: Array.isArray(raw.aliases) ? raw.aliases : [],
            }));

        this.emojiCache.set(host, { emojis, expiresAt: now + MisskeyClient.EMOJI_CACHE_TTL_MS });

        return emojis;
    }

    public async getTimeline(host: string, token: string, option: MisskeyTimelineOption): Promise<MisskeyNote[]> {
        const limit = Math.min(
            Math.max(option.limit ?? MisskeyClient.TIMELINE_DEFAULT_LIMIT, 1),
            MisskeyClient.TIMELINE_MAX_LIMIT,
        );
        const payload: Record<string, unknown> = { i: token, limit };
        if (typeof option.untilId === 'string' && option.untilId !== '') payload.untilId = option.untilId;

        let path: string;
        switch (option.type) {
            case 'social':
                path = '/api/notes/hybrid-timeline';
                break;
            case 'local':
                path = '/api/notes/local-timeline';
                break;
            case 'channel':
                if (typeof option.channelId !== 'string' || option.channelId === '') {
                    throw new Error('MisskeyTimelineChannelIdIsRequired');
                }
                path = '/api/channels/timeline';
                payload.channelId = option.channelId;
                break;
            case 'home':
            default:
                path = '/api/notes/timeline';
                break;
        }

        const body = await this.post<RawMisskeyNoteBody[]>(host, path, payload);

        return (Array.isArray(body) ? body : []).map(raw => this.toNote(raw));
    }

    public async createReaction(host: string, token: string, noteId: string, reaction: string): Promise<void> {
        await this.postVoid(host, '/api/notes/reactions/create', { i: token, noteId, reaction });
    }

    public async deleteReaction(host: string, token: string, noteId: string): Promise<void> {
        await this.postVoid(host, '/api/notes/reactions/delete', { i: token, noteId });
    }

    public async renote(host: string, token: string, noteId: string): Promise<MisskeyCreateNoteResult> {
        const body = await this.post<RawMisskeyNote>(host, '/api/notes/create', { i: token, renoteId: noteId });
        const createdId = this.extractNoteId(body);

        return { id: createdId, url: `https://${host}/notes/${createdId}` };
    }

    /**
     * notes/create の応答からノート id を取り出す (`createdNote.id` が実際の応答形式)
     */
    private extractNoteId(body: RawMisskeyNote): string {
        const id = body.createdNote?.id ?? body.id;
        if (typeof id !== 'string') throw new MisskeyApiError(200, 'invalid_response', 'note id is missing');

        return id;
    }

    /**
     * Misskey のノート応答を欠損に強い形へ変換する
     */
    private toNote(raw: RawMisskeyNoteBody): MisskeyNote {
        return {
            id: raw.id ?? '',
            createdAt: raw.createdAt ?? new Date(0).toISOString(),
            text: typeof raw.text === 'string' ? raw.text : null,
            cw: typeof raw.cw === 'string' && raw.cw !== '' ? raw.cw : null,
            // toUser() は id / username 欠損を例外にするが、タイムラインは 1 ノートの欠損で全体を落としたくないため
            // ここでは緩く変換する
            user: {
                id: raw.user?.id ?? '',
                username: raw.user?.username ?? '',
                name: typeof raw.user?.name === 'string' && raw.user.name !== '' ? raw.user.name : null,
                avatarUrl:
                    typeof raw.user?.avatarUrl === 'string' && raw.user.avatarUrl !== '' ? raw.user.avatarUrl : null,
                host: typeof raw.user?.host === 'string' && raw.user.host !== '' ? raw.user.host : null,
            },
            files: (raw.files ?? []).map((file): MisskeyNoteFile => ({
                url: file.url ?? null,
                thumbnailUrl: file.thumbnailUrl ?? null,
                isSensitive: file.isSensitive === true,
            })),
            reactions: raw.reactions ?? {},
            reactionEmojis: raw.reactionEmojis ?? {},
            myReaction: raw.myReaction ?? null,
            renoteCount: raw.renoteCount ?? 0,
            renote: typeof raw.renote !== 'undefined' && raw.renote !== null ? this.toNote(raw.renote) : null,
        };
    }

    private toUser(raw: RawMisskeyUser): MisskeyUser {
        if (typeof raw.id !== 'string' || typeof raw.username !== 'string') {
            throw new MisskeyApiError(200, 'invalid_response', 'user response is missing required fields');
        }

        return {
            id: raw.id,
            username: raw.username,
            name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : null,
            avatarUrl: typeof raw.avatarUrl === 'string' && raw.avatarUrl !== '' ? raw.avatarUrl : null,
            host: typeof raw.host === 'string' && raw.host !== '' ? raw.host : null,
        };
    }

    private async get<T>(host: string, path: string): Promise<T> {
        const response = await this.http.get(`https://${host}${path}`);
        const parsed = response.json<T & MisskeyErrorBody>();
        this.throwIfError(response.status, parsed);

        return parsed;
    }

    private async post<T>(host: string, path: string, body: Record<string, unknown>): Promise<T> {
        const response = await this.http.post(`https://${host}${path}`, JSON.stringify(body), {
            headers: { 'content-type': 'application/json' },
        });
        const parsed = response.json<T & MisskeyErrorBody>();
        this.throwIfError(response.status, parsed);

        return parsed;
    }

    /**
     * JSON本文を返さないMisskey APIへPOSTする。
     * @param host: string
     * @param path: string
     * @param body: Record<string, unknown>
     * @return Promise<void>
     */
    private async postVoid(host: string, path: string, body: Record<string, unknown>): Promise<void> {
        const response = await this.http.post(`https://${host}${path}`, JSON.stringify(body), {
            headers: { 'content-type': 'application/json' },
        });
        const text = response.text;
        const parsed: MisskeyErrorBody = text === '' ? {} : JSON.parse(text);
        this.throwIfError(response.status, parsed);
    }

    private throwIfError(status: number, body: MisskeyErrorBody): void {
        if (status >= 200 && status < 300 && typeof body.error === 'undefined') return;
        const code = body.error?.code ?? `HTTP_${status}`;
        const message = body.error?.message ?? `unexpected status ${status}`;
        throw new MisskeyApiError(status, code, message);
    }
}
