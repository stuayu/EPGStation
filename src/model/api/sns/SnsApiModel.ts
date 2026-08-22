import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import SnsAccount from '../../../db/entities/SnsAccount';
import ISnsAccountDB from '../../db/ISnsAccountDB';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import ISecretCrypto from '../../security/ISecretCrypto';
import IBlueskyClient, { BlueskyApiError, BlueskyBlobRef } from '../../sns/IBlueskyClient';
import IMisskeyClient, { MisskeyApiError } from '../../sns/IMisskeyClient';
import IMisskeyAuthModel from '../../sns/IMisskeyAuthModel';
import { buildBlueskyFacets } from '../../sns/BlueskyFacetUtil';
import { buildBlueskyPostUrl, convertBlueskyFeedViewPostToTimelineNote } from '../../sns/BlueskyTimelineConverter';
import { convertMisskeyNoteToTimelineNote } from '../../sns/MisskeyTimelineConverter';
import ISnsApiModel from './ISnsApiModel';

interface BlueskyCredential {
    identifier: string;
    appPassword: string;
    accessJwt: string;
    refreshJwt: string;
}

interface MisskeyCredential {
    accessToken: string;
}

interface DecodedImage {
    buffer: Buffer;
    mimeType: string;
}

/**
 * `data:<mime>;base64,<data>` 形式の data URL をデコードする
 * @param dataUrl: string
 * @return DecodedImage
 */
const parseDataUrl = (dataUrl: string): DecodedImage => {
    const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl);
    if (match === null) throw new Error('SnsPostImageIsInvalid');

    return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
};

/**
 * mime type から拡張子を推定する (Misskey へのアップロード時のファイル名用)
 * @param mimeType: string
 * @return string
 */
const extensionFromMimeType = (mimeType: string): string => {
    switch (mimeType) {
        case 'image/png':
            return 'png';
        case 'image/webp':
            return 'webp';
        case 'image/gif':
            return 'gif';
        default:
            return 'jpg';
    }
};

// Misskey が権限不足を表すときに返す error.code。実機 (misskey.io) で write:reactions の無いトークンを
// 使ったところ PERMISSION_DENIED が確認できた。CREDENTIAL_REQUIRED / ACCESS_DENIED も同系統のエラーとして扱う
const MISSKEY_PERMISSION_ERROR_CODES = new Set(['PERMISSION_DENIED', 'CREDENTIAL_REQUIRED', 'ACCESS_DENIED']);

/**
 * エラーオブジェクトから利用者向けの文言を取り出す。
 * Misskey が権限不足エラーを返した場合は「再連携が必要」と分かる文言にする
 * (MiAuth は permission がトークン発行時に固定されるため、この場合は再試行では直らない)
 * @param e: unknown
 * @return string
 */
const describeError = (e: unknown): string => {
    if (e instanceof MisskeyApiError && MISSKEY_PERMISSION_ERROR_CODES.has(e.code)) {
        return `Misskey 側の権限が不足しています。アカウントの再連携が必要です (${e.code}: ${e.detail})`;
    }
    // Misskey のエラーは code (機械可読な種別) も画面に出す。detail (message) だけだと
    // 「INVALID_PARAM」なのか「容量超過」なのか利用者が判断できない
    if (e instanceof MisskeyApiError) return `${e.code}: ${e.detail}`;
    if (e instanceof BlueskyApiError) return e.detail;
    if (e instanceof Error) return e.message;

    return String(e);
};

@injectable()
export default class SnsApiModel implements ISnsApiModel {
    // 1 投稿あたりの画像の最大枚数
    private static readonly MAX_IMAGES = 4;
    // Bluesky の blob 上限 (2MB)。超えるものはクライアント側で縮小してから送る前提で、
    // サーバーは超過を検知してエラーを返すだけにする
    private static readonly BLUESKY_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
    // App Password ログインの既定 PDS ホスト。セルフホスト用に呼び出し側で差し替え可能
    private static readonly DEFAULT_BLUESKY_SERVICE = 'bsky.social';
    // reaction が省略された場合に使う既定のリアクション (Misskey)
    private static readonly DEFAULT_MISSKEY_REACTION = '👍';
    // タイムライン取得の limit の既定値 / 上限
    private static readonly TIMELINE_DEFAULT_LIMIT = 20;
    private static readonly TIMELINE_MAX_LIMIT = 50;

    private log: ILogger;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('ISnsAccountDB') private readonly snsAccountDB: ISnsAccountDB,
        @inject('ISecretCrypto') private readonly crypto: ISecretCrypto,
        @inject('IBlueskyClient') private readonly blueskyClient: IBlueskyClient,
        @inject('IMisskeyClient') private readonly misskeyClient: IMisskeyClient,
        @inject('IMisskeyAuthModel') private readonly misskeyAuthModel: IMisskeyAuthModel,
    ) {
        this.log = logger.getLogger();
    }

    public async getAccounts(userId: number | null): Promise<apid.SnsAccountItems> {
        const rows = await this.snsAccountDB.findByUser(userId);

        return { items: rows.map(row => this.toApiItem(row)) };
    }

    public async updateAccount(
        userId: number | null,
        id: apid.SnsAccountId,
        option: apid.UpdateSnsAccountOption,
    ): Promise<void> {
        const account = await this.findOwnedAccount(userId, id);

        if (typeof option.defaultVisibility !== 'undefined') account.defaultVisibility = option.defaultVisibility;
        if (typeof option.defaultChannelId !== 'undefined') account.defaultChannelId = option.defaultChannelId;
        if (typeof option.defaultChannelName !== 'undefined') account.defaultChannelName = option.defaultChannelName;
        if (typeof option.isDefaultLocalOnly !== 'undefined') account.isDefaultLocalOnly = option.isDefaultLocalOnly;
        account.updatedAt = Date.now();

        await this.snsAccountDB.update(account);
    }

    public async deleteAccount(userId: number | null, id: apid.SnsAccountId): Promise<void> {
        await this.findOwnedAccount(userId, id);
        await this.snsAccountDB.delete(id);
    }

    public async loginBluesky(userId: number | null, option: apid.SnsBlueskyLoginOption): Promise<apid.SnsAccountItem> {
        const service =
            typeof option.service === 'string' && option.service !== ''
                ? option.service
                : SnsApiModel.DEFAULT_BLUESKY_SERVICE;

        let session;
        try {
            session = await this.blueskyClient.login(option.identifier, option.appPassword, service);
        } catch (e) {
            this.log.system.warn(`SnsApiModel: bluesky login failed (${describeError(e)})`);
            throw new Error('SnsBlueskyLoginFailed');
        }

        const profile = await this.blueskyClient.getProfile(session.accessJwt, session.did, service).catch(() => null);
        const credential: BlueskyCredential = {
            identifier: option.identifier,
            appPassword: option.appPassword,
            accessJwt: session.accessJwt,
            refreshJwt: session.refreshJwt,
        };

        const now = Date.now();
        const existing = await this.snsAccountDB.findDuplicate('bluesky', userId, session.did, service);
        const row = existing ?? new SnsAccount();
        row.provider = 'bluesky';
        row.userId = userId;
        row.remoteUserId = session.did;
        row.instanceUrl = service;
        row.handle = profile?.handle ?? session.handle;
        row.displayName = profile?.displayName ?? profile?.handle ?? session.handle;
        row.avatarUrl = profile?.avatarUrl ?? null;
        row.credential = this.crypto.encrypt(JSON.stringify(credential));
        row.updatedAt = now;
        if (existing === null) {
            row.defaultVisibility = null;
            row.defaultChannelId = null;
            row.defaultChannelName = null;
            row.isDefaultLocalOnly = false;
            row.createdAt = now;
            row.id = await this.snsAccountDB.insertOnce(row);
        } else {
            await this.snsAccountDB.update(row);
        }

        return this.toApiItem(row);
    }

    public async createMisskeyAuthSession(
        userId: number | null,
        option: apid.SnsMisskeyAuthOption,
        baseUrl: string,
    ): Promise<apid.SnsMisskeyAuthSession> {
        return this.misskeyAuthModel.createSession(option.instanceUrl, userId, baseUrl);
    }

    public async completeMisskeyAuth(userId: number | null, sessionId: string): Promise<void> {
        const result = await this.misskeyAuthModel.completeSession(sessionId, userId);
        const credential: MisskeyCredential = { accessToken: result.token };

        const now = Date.now();
        const existing = await this.snsAccountDB.findDuplicate('misskey', userId, result.remoteUserId, result.host);
        const row = existing ?? new SnsAccount();
        row.provider = 'misskey';
        row.userId = userId;
        row.remoteUserId = result.remoteUserId;
        row.instanceUrl = result.host;
        row.handle = result.handle;
        row.displayName = result.displayName;
        row.avatarUrl = result.avatarUrl;
        row.credential = this.crypto.encrypt(JSON.stringify(credential));
        // MiAuth は permission がトークン発行時に固定されるため、このトークンで実際に要求した
        // permission 一覧を記録しておく (現在の要求権限と比較して再連携が必要かを判定するため)
        row.grantedPermissions = JSON.stringify(result.grantedPermissions);
        row.updatedAt = now;
        if (existing === null) {
            row.defaultVisibility = 'public';
            row.defaultChannelId = null;
            row.defaultChannelName = null;
            row.isDefaultLocalOnly = false;
            row.createdAt = now;
            await this.snsAccountDB.insertOnce(row);
        } else {
            await this.snsAccountDB.update(row);
        }
    }

    public async getMisskeyChannels(
        userId: number | null,
        accountId: apid.SnsAccountId,
    ): Promise<apid.SnsMisskeyChannels> {
        const account = await this.findOwnedAccount(userId, accountId);
        if (account.provider !== 'misskey' || account.instanceUrl === null) throw new Error('SnsAccountIsNull');

        const credential = this.decryptCredential<MisskeyCredential>(account);
        const channels = await this.misskeyClient.getChannels(account.instanceUrl, credential.accessToken);

        return { items: channels };
    }

    public async post(userId: number | null, option: apid.SnsPostOption): Promise<apid.SnsPostResult> {
        if (option.accountIds.length === 0) throw new Error('SnsPostAccountIdsIsEmpty');
        const images = option.images ?? [];
        if (images.length > SnsApiModel.MAX_IMAGES) throw new Error('SnsPostTooManyImages');
        const decodedImages = images.map(image => parseDataUrl(image.dataUrl));

        const results = await Promise.all(
            option.accountIds.map(accountId =>
                this.postToAccount(userId, accountId, option.text, decodedImages, option.misskey),
            ),
        );

        return { results };
    }

    public async getTimeline(
        userId: number | null,
        accountId: apid.SnsAccountId,
        type: apid.SnsTimelineType | undefined,
        channelId: string | undefined,
        limit: number | undefined,
        cursor: string | undefined,
    ): Promise<apid.SnsTimeline> {
        const account = await this.findOwnedAccount(userId, accountId);
        const normalizedLimit = Math.min(
            Math.max(limit ?? SnsApiModel.TIMELINE_DEFAULT_LIMIT, 1),
            SnsApiModel.TIMELINE_MAX_LIMIT,
        );

        if (account.provider === 'misskey') {
            if (account.instanceUrl === null) throw new Error('SnsAccountInstanceUrlIsNull');
            const timelineType = type ?? 'home';
            if (timelineType === 'channel' && (typeof channelId !== 'string' || channelId === '')) {
                throw new Error('SnsTimelineChannelIdIsRequired');
            }

            const credential = this.decryptCredential<MisskeyCredential>(account);
            const [notes, emojis] = await Promise.all([
                this.misskeyClient.getTimeline(account.instanceUrl, credential.accessToken, {
                    type: timelineType,
                    channelId,
                    limit: normalizedLimit,
                    untilId: cursor,
                }),
                // リアクション絵文字の解決に使う。取得できなくても TL 表示自体は続行する
                this.misskeyClient.getEmojis(account.instanceUrl).catch(() => []),
            ]);
            const emojiUrlByName = new Map(emojis.map(emoji => [emoji.name, emoji.url]));

            return {
                notes: notes.map(note =>
                    convertMisskeyNoteToTimelineNote(
                        account.instanceUrl as string,
                        note,
                        name => emojiUrlByName.get(name) ?? null,
                    ),
                ),
                cursor: notes.length > 0 ? notes[notes.length - 1].id : null,
            };
        }

        const service = account.instanceUrl ?? SnsApiModel.DEFAULT_BLUESKY_SERVICE;
        const response = await this.withBlueskyRetry(account, service, accessJwt =>
            this.blueskyClient.getTimeline(accessJwt, { limit: normalizedLimit, cursor }, service),
        );

        return {
            notes: response.feed.map(item => convertBlueskyFeedViewPostToTimelineNote(item)),
            cursor: response.cursor ?? null,
        };
    }

    public async getMisskeyEmojis(userId: number | null, accountId: apid.SnsAccountId): Promise<apid.SnsMisskeyEmojis> {
        const account = await this.findOwnedAccount(userId, accountId);
        if (account.provider !== 'misskey' || account.instanceUrl === null) throw new Error('SnsAccountIsNull');

        return { emojis: await this.misskeyClient.getEmojis(account.instanceUrl) };
    }

    public async addReaction(userId: number | null, option: apid.SnsReactionOption): Promise<apid.SnsReactionResult> {
        const account = await this.findOwnedAccount(userId, option.accountId);

        try {
            if (account.provider === 'misskey') {
                if (account.instanceUrl === null) throw new Error('SnsAccountInstanceUrlIsNull');
                const credential = this.decryptCredential<MisskeyCredential>(account);
                const reaction =
                    typeof option.reaction === 'string' && option.reaction !== ''
                        ? option.reaction
                        : SnsApiModel.DEFAULT_MISSKEY_REACTION;
                await this.misskeyClient.createReaction(
                    account.instanceUrl,
                    credential.accessToken,
                    option.noteId,
                    reaction,
                );

                return { isSuccess: true };
            }

            if (typeof option.cid !== 'string' || option.cid === '') throw new Error('SnsReactionCidIsRequired');
            const service = account.instanceUrl ?? SnsApiModel.DEFAULT_BLUESKY_SERVICE;
            const result = await this.withBlueskyRetry(account, service, accessJwt =>
                this.blueskyClient.like(accessJwt, account.remoteUserId, option.noteId, option.cid as string, service),
            );
            const reactionKey = result.uri.split('/').pop() ?? '';

            return { isSuccess: true, reactionKey };
        } catch (e) {
            this.log.system.warn(`SnsApiModel: failed to add reaction (${describeError(e)})`);

            return { isSuccess: false, detail: describeError(e) };
        }
    }

    public async removeReaction(
        userId: number | null,
        option: apid.SnsReactionOption,
    ): Promise<apid.SnsReactionResult> {
        const account = await this.findOwnedAccount(userId, option.accountId);

        try {
            if (account.provider === 'misskey') {
                if (account.instanceUrl === null) throw new Error('SnsAccountInstanceUrlIsNull');
                const credential = this.decryptCredential<MisskeyCredential>(account);
                await this.misskeyClient.deleteReaction(account.instanceUrl, credential.accessToken, option.noteId);

                return { isSuccess: true };
            }

            if (typeof option.reactionKey !== 'string' || option.reactionKey === '') {
                throw new Error('SnsReactionKeyIsRequired');
            }
            const service = account.instanceUrl ?? SnsApiModel.DEFAULT_BLUESKY_SERVICE;
            await this.withBlueskyRetry(account, service, accessJwt =>
                this.blueskyClient.deleteLike(accessJwt, account.remoteUserId, option.reactionKey as string, service),
            );

            return { isSuccess: true };
        } catch (e) {
            this.log.system.warn(`SnsApiModel: failed to remove reaction (${describeError(e)})`);

            return { isSuccess: false, detail: describeError(e) };
        }
    }

    public async renote(userId: number | null, option: apid.SnsRenoteOption): Promise<apid.SnsRenoteResult> {
        const account = await this.findOwnedAccount(userId, option.accountId);

        try {
            if (account.provider === 'misskey') {
                if (account.instanceUrl === null) throw new Error('SnsAccountInstanceUrlIsNull');
                const credential = this.decryptCredential<MisskeyCredential>(account);
                const result = await this.misskeyClient.renote(
                    account.instanceUrl,
                    credential.accessToken,
                    option.noteId,
                );

                return { isSuccess: true, url: result.url };
            }

            if (typeof option.cid !== 'string' || option.cid === '') throw new Error('SnsReactionCidIsRequired');
            const service = account.instanceUrl ?? SnsApiModel.DEFAULT_BLUESKY_SERVICE;
            await this.withBlueskyRetry(account, service, accessJwt =>
                this.blueskyClient.repost(
                    accessJwt,
                    account.remoteUserId,
                    option.noteId,
                    option.cid as string,
                    service,
                ),
            );

            return { isSuccess: true, url: buildBlueskyPostUrl(option.noteId) ?? undefined };
        } catch (e) {
            this.log.system.warn(`SnsApiModel: failed to renote (${describeError(e)})`);

            return { isSuccess: false, detail: describeError(e) };
        }
    }

    // ------------------------------------------------------------------

    private async postToAccount(
        userId: number | null,
        accountId: apid.SnsAccountId,
        text: string,
        images: DecodedImage[],
        misskeyOption: apid.SnsPostMisskeyOption | undefined,
    ): Promise<apid.SnsPostAccountResult> {
        const account = await this.snsAccountDB.findById(accountId);
        if (account === null) {
            return { accountId, provider: 'bluesky', isSuccess: false, detail: 'SnsAccountIsNull' };
        }
        // 認証有効時は他人のアカウントで投稿できないよう userId の一致を必ず検証する
        if (account.userId !== userId) {
            return { accountId, provider: account.provider, isSuccess: false, detail: 'SnsAccountIsNull' };
        }

        try {
            const url =
                account.provider === 'bluesky'
                    ? await this.postToBluesky(account, text, images)
                    : await this.postToMisskey(account, text, images, misskeyOption);

            return { accountId, provider: account.provider, isSuccess: true, url };
        } catch (e) {
            this.log.system.warn(`SnsApiModel: failed to post to sns account ${accountId} (${describeError(e)})`);

            return { accountId, provider: account.provider, isSuccess: false, detail: describeError(e) };
        }
    }

    private async postToBluesky(account: SnsAccount, text: string, images: DecodedImage[]): Promise<string> {
        for (const image of images) {
            if (image.buffer.length > SnsApiModel.BLUESKY_MAX_IMAGE_BYTES) {
                throw new Error('SnsPostImageTooLarge');
            }
        }

        const service = account.instanceUrl ?? SnsApiModel.DEFAULT_BLUESKY_SERVICE;

        const uploadedImages: { blob: BlueskyBlobRef; alt: string }[] = [];
        for (const image of images) {
            const blob = await this.withBlueskyRetry(account, service, accessJwt =>
                this.blueskyClient.uploadBlob(accessJwt, image.buffer, image.mimeType, service),
            );
            uploadedImages.push({ blob, alt: '' });
        }

        const facets = buildBlueskyFacets(text);
        const result = await this.withBlueskyRetry(account, service, accessJwt =>
            this.blueskyClient.createPost(
                accessJwt,
                account.remoteUserId,
                { text, facets, images: uploadedImages },
                service,
            ),
        );

        const rkey = result.uri.split('/').pop() ?? '';

        return `https://bsky.app/profile/${account.handle}/post/${rkey}`;
    }

    /**
     * Bluesky API 呼び出しの共通リトライ処理。
     * 401 を受けたら 1 度だけ `refresh()` して再試行し、それも失敗したら保存済み App Password で
     * `login()` し直す (`createPost` も含め、Bluesky を叩くすべての箇所がこの経路を通る)
     * @param account: SnsAccount
     * @param service: string PDS ホスト
     * @param fn: (accessJwt: string) => Promise<T>
     * @return Promise<T>
     */
    private async withBlueskyRetry<T>(
        account: SnsAccount,
        service: string,
        fn: (accessJwt: string) => Promise<T>,
    ): Promise<T> {
        let credential = this.decryptCredential<BlueskyCredential>(account);
        try {
            return await fn(credential.accessJwt);
        } catch (e) {
            if (e instanceof BlueskyApiError && e.status === 401) {
                credential = await this.refreshBlueskyCredential(account, credential, service);

                return await fn(credential.accessJwt);
            }
            throw e;
        }
    }

    /**
     * refresh または再ログインで新しい JWT を取得し、`credential` へ書き戻す
     */
    private async refreshBlueskyCredential(
        account: SnsAccount,
        credential: BlueskyCredential,
        service: string,
    ): Promise<BlueskyCredential> {
        let refreshed: BlueskyCredential;
        try {
            const session = await this.blueskyClient.refresh(credential.refreshJwt, service);
            refreshed = { ...credential, accessJwt: session.accessJwt, refreshJwt: session.refreshJwt };
        } catch (e) {
            this.log.system.info(`SnsApiModel: bluesky session refresh failed, re-login (${describeError(e)})`);
            const session = await this.blueskyClient.login(credential.identifier, credential.appPassword, service);
            refreshed = { ...credential, accessJwt: session.accessJwt, refreshJwt: session.refreshJwt };
        }

        account.credential = this.crypto.encrypt(JSON.stringify(refreshed));
        account.updatedAt = Date.now();
        await this.snsAccountDB.update(account);

        return refreshed;
    }

    private async postToMisskey(
        account: SnsAccount,
        text: string,
        images: DecodedImage[],
        misskeyOption: apid.SnsPostMisskeyOption | undefined,
    ): Promise<string> {
        if (account.instanceUrl === null) throw new Error('SnsAccountInstanceUrlIsNull');
        const credential = this.decryptCredential<MisskeyCredential>(account);

        const fileIds: string[] = [];
        for (const image of images) {
            const filename = `epgstation-${Date.now()}-${fileIds.length}.${extensionFromMimeType(image.mimeType)}`;
            fileIds.push(
                await this.misskeyClient.uploadFile(
                    account.instanceUrl,
                    credential.accessToken,
                    image.buffer,
                    filename,
                    image.mimeType,
                ),
            );
        }

        const visibility =
            misskeyOption?.visibility ?? (account.defaultVisibility as apid.SnsVisibility | null) ?? 'public';
        const localOnly = misskeyOption?.localOnly ?? account.isDefaultLocalOnly;
        const channelId =
            typeof misskeyOption?.channelId !== 'undefined' ? misskeyOption.channelId : account.defaultChannelId;
        const cw = misskeyOption?.cw ?? null;

        const result = await this.misskeyClient.createNote(account.instanceUrl, credential.accessToken, {
            text,
            visibility,
            localOnly,
            channelId,
            fileIds,
            cw,
        });

        return result.url;
    }

    /**
     * id で所有者を検証した上でアカウントを取得する。
     * 存在しない場合と他人のアカウントの場合を同じエラーにして存在を推測されないようにする
     */
    private async findOwnedAccount(userId: number | null, id: number): Promise<SnsAccount> {
        const account = await this.snsAccountDB.findById(id);
        if (account === null || account.userId !== userId) throw new Error('SnsAccountIsNull');

        return account;
    }

    private decryptCredential<T>(account: SnsAccount): T {
        if (this.crypto.isEncrypted(account.credential) === false) throw new Error('SnsAccountNeedsReauth');

        return JSON.parse(this.crypto.decrypt(account.credential)) as T;
    }

    private toApiItem(row: SnsAccount): apid.SnsAccountItem {
        const reason = this.getReauthReason(row);

        return {
            id: row.id,
            provider: row.provider,
            remoteUserId: row.remoteUserId,
            instanceUrl: row.instanceUrl,
            handle: row.handle,
            displayName: row.displayName,
            avatarUrl: row.avatarUrl,
            defaultVisibility: row.defaultVisibility as apid.SnsVisibility | null,
            defaultChannelId: row.defaultChannelId,
            defaultChannelName: row.defaultChannelName,
            isDefaultLocalOnly: row.isDefaultLocalOnly,
            needsReauth: reason !== null,
            needsReauthReason: reason,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }

    /**
     * 再連携が必要かどうかとその理由を判定する。
     * 1. credential が未暗号化 (鍵ローテーション等で復号できない状態) -> 'encryption'
     * 2. Misskey アカウントで、連携時点の permission (`grantedPermissions`) が現在アプリが
     *    要求する permission を満たしていない -> 'permission'
     *    (MiAuth は permission がトークン発行時に固定されるため、要求権限を増やしても
     *    既存トークンには反映されない。`grantedPermissions` が無い行 = このカラムが追加される前に
     *    連携された行も、現在の要求権限を満たしているか判断できないため再連携対象に含める)
     * @param row: SnsAccount
     * @return 'encryption' | 'permission' | null
     */
    private getReauthReason(row: SnsAccount): 'encryption' | 'permission' | null {
        if (this.crypto.isEncrypted(row.credential) === false) return 'encryption';

        if (row.provider === 'misskey') {
            const required = this.misskeyAuthModel.getRequiredPermissions();
            const granted = this.parseGrantedPermissions(row.grantedPermissions);
            if (granted === null || required.some(p => granted.includes(p) === false)) return 'permission';
        }

        return null;
    }

    private parseGrantedPermissions(value: string | null): string[] | null {
        if (value === null) return null;
        try {
            const parsed: unknown = JSON.parse(value);

            return Array.isArray(parsed) && parsed.every(p => typeof p === 'string') ? (parsed as string[]) : null;
        } catch {
            return null;
        }
    }
}
