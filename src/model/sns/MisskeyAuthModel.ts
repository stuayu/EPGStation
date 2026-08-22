import { randomUUID } from 'crypto';
import { inject, injectable } from 'inversify';
import IConfiguration from '../IConfiguration';
import IMisskeyClient from './IMisskeyClient';
import IMisskeyAuthModel, { CompleteMisskeyAuthResult, CreateMisskeyAuthSessionResult } from './IMisskeyAuthModel';
import MisskeyAuthSessionStore from './MisskeyAuthSessionStore';

@injectable()
export default class MisskeyAuthModel implements IMisskeyAuthModel {
    // 過剰な権限を要求しない。実際に叩いている API に対応する権限だけを要求する:
    // notes/create -> write:notes / drive/files/create -> write:drive /
    // i (自分の情報取得) -> read:account / channels/followed,owned (チャンネル選択) -> read:channels /
    // notes/reactions/create,delete -> write:reactions。
    // notes/timeline, notes/hybrid-timeline, notes/local-timeline, channels/timeline, emojis は
    // 実機の misskey.io で確認した限り追加の permission を要求しないため含めない
    private static readonly PERMISSIONS = [
        'write:notes',
        'write:drive',
        'read:account',
        'read:channels',
        'write:reactions',
    ];
    private static readonly APP_NAME = 'EPGStation';

    private readonly store = new MisskeyAuthSessionStore();

    constructor(
        @inject('IConfiguration') private readonly configuration: IConfiguration,
        @inject('IMisskeyClient') private readonly misskeyClient: IMisskeyClient,
    ) {}

    public createSession(instanceUrl: string, userId: number | null, baseUrl: string): CreateMisskeyAuthSessionResult {
        const host = this.misskeyClient.normalizeInstanceUrl(instanceUrl);
        if (host === '') throw new Error('MisskeyInstanceUrlIsInvalid');

        const sessionId = randomUUID();
        this.store.create(sessionId, host, userId);

        // callback にクエリを付けると Misskey のバージョンによって連結が `&` になり壊れることがあるため付けない。
        // session id は Misskey がリダイレクト時に自動で ?session=<id> を付与する
        const callbackUrl = `${this.getApiBase(baseUrl)}/sns/misskey/callback`;
        const params = new URLSearchParams({
            name: MisskeyAuthModel.APP_NAME,
            callback: callbackUrl,
            permission: MisskeyAuthModel.PERMISSIONS.join(','),
        });
        const authUrl = `https://${host}/miauth/${sessionId}?${params.toString()}`;

        return { sessionId, authUrl };
    }

    public async completeSession(sessionId: string, userId: number | null): Promise<CompleteMisskeyAuthResult> {
        const session = this.store.get(sessionId);
        if (session === null) throw new Error('MisskeyAuthSessionNotFound');
        // セッションを作った本人以外がコールバックを成立させられないようにする (CSRF / 取り違え対策)
        if (session.userId !== userId) throw new Error('MisskeyAuthSessionUserMismatch');
        // 一度使ったセッションは再利用させない
        this.store.remove(sessionId);

        const result = await this.misskeyClient.checkAuth(session.host, sessionId);

        return {
            host: session.host,
            token: result.token,
            remoteUserId: result.user.id,
            handle: result.user.username,
            displayName: result.user.name ?? result.user.username,
            avatarUrl: result.user.avatarUrl,
            grantedPermissions: [...MisskeyAuthModel.PERMISSIONS],
        };
    }

    public getRequiredPermissions(): string[] {
        return [...MisskeyAuthModel.PERMISSIONS];
    }

    /**
     * subDirectory 運用でも正しい URL になるよう API のベースを組み立てる
     * (`src/model/auth/OAuthModel.ts` の `getApiBase()` と同じロジック)
     */
    private getApiBase(baseUrl: string): string {
        const sub = this.configuration.getConfig().subDirectory;
        const prefix = typeof sub === 'string' && sub !== '' ? (sub.startsWith('/') ? sub : `/${sub}`) : '';

        return `${baseUrl}${prefix}/api`;
    }
}
