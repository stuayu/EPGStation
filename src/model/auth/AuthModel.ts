import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import IConfiguration from '../IConfiguration';
import IUserDB from '../db/IUserDB';
import ISecretCrypto from '../security/ISecretCrypto';
import IAuthModel, { AuthStatus, AuthUserItem, LoginResult } from './IAuthModel';
import { assertValidPassword, hashPassword, verifyPassword } from './PasswordHash';
import { createSessionToken, SessionPayload, verifySessionToken } from './SessionToken';

@injectable()
export default class AuthModel implements IAuthModel {
    // セッションの既定有効期間 (30 日)
    private static readonly DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    private static readonly MIN_SESSION_TTL_MS = 60 * 1000;
    private static readonly MAX_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
    // セッション署名鍵の用途分離子 (暗号化鍵をそのまま署名に使わない)
    private static readonly SIGNING_PURPOSE = 'session';
    // 外部プレイヤー・IPTV クライアント向けトークンの署名用途 (セッションとは鍵を分ける)
    private static readonly MEDIA_SIGNING_PURPOSE = 'media';
    // 外部プレイヤー用トークンの既定有効期間 (URL に埋めて使い回されるため長めに取る)
    private static readonly DEFAULT_MEDIA_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;
    // tokenVersion の照合で毎リクエスト DB を引かないためのキャッシュ保持時間
    private static readonly VERSION_CACHE_MS = 30 * 1000;
    private static readonly MAX_NAME_LENGTH = 64;

    /**
     * 未知の値は必ず一般権限に倒す (壊れたデータで管理者にしない)
     */
    private static toRole(value: unknown): apid.AuthRole {
        return value === 'admin' ? 'admin' : 'user';
    }

    // tokenVersion と権限のキャッシュ。権限はトークンの値ではなくこちらを正とするため、
    // 管理者権限の付与・剥奪が再ログインなしで (最大 VERSION_CACHE_MS 遅れて) 反映される
    private versionCache = new Map<number, { version: number; role: string; at: number }>();

    constructor(
        @inject('IConfiguration') private configuration: IConfiguration,
        @inject('IUserDB') private db: IUserDB,
        @inject('ISecretCrypto') private crypto: ISecretCrypto,
    ) {}

    public isEnabled(): boolean {
        // 未指定は有効として扱う (opt-out)。無効にしたい場合のみ config.yml に false を書く
        return this.configuration.getConfig().auth?.enabled !== false;
    }

    public isAnonymousAllowed(): boolean {
        // 認証が無効ならそもそも全員が制限なしなので false を返す (画面側の分岐を単純にするため)。
        // 未指定は許可 (opt-out)。日常操作はログイン不要のまま、管理者向け操作だけを保護する
        return this.isEnabled() === true && this.configuration.getConfig().auth?.allowAnonymous !== false;
    }

    public createMediaToken(payload: SessionPayload): string | null {
        const secret = this.crypto.getSigningKey(AuthModel.MEDIA_SIGNING_PURPOSE);
        if (secret === null) return null;

        return createSessionToken({ ...payload, exp: Date.now() + this.getMediaTokenTtlMs() }, secret);
    }

    public async verifyMediaToken(token: string | null): Promise<SessionPayload | null> {
        const secret = this.crypto.getSigningKey(AuthModel.MEDIA_SIGNING_PURPOSE);
        if (secret === null) return null;
        const payload = verifySessionToken(token, secret);
        if (payload === null) return null;

        // セッションと同じくパスワード変更・ユーザー削除で失効させる
        const current = await this.getCurrentUser(payload.uid);
        if (current === null || current.version !== payload.ver) return null;

        return { ...payload, role: current.role };
    }

    private getMediaTokenTtlMs(): number {
        const value = this.configuration.getConfig().auth?.mediaTokenTtlMs;
        if (typeof value !== 'number' || Number.isFinite(value) === false) return AuthModel.DEFAULT_MEDIA_TOKEN_TTL_MS;

        return Math.min(Math.max(value, AuthModel.MIN_SESSION_TTL_MS), AuthModel.MAX_SESSION_TTL_MS);
    }

    public async getStatus(token: string | null): Promise<AuthStatus> {
        const enabled = this.isEnabled();
        // providers は OAuthModel が持つ情報なので、ここでは空で返して呼び出し側 (ルート) が埋める
        if (enabled === false) {
            return {
                enabled: false,
                initialized: true,
                user: null,
                providers: [],
                allowSignUp: false,
                allowAnonymous: false,
            };
        }
        const initialized = (await this.db.count()) > 0;
        const payload = initialized === true ? await this.verify(token) : null;
        return {
            enabled: true,
            initialized,
            user:
                payload === null ? null : { id: payload.uid, name: payload.name, role: AuthModel.toRole(payload.role) },
            providers: [],
            allowSignUp: this.isSignUpAllowed(),
            allowAnonymous: this.isAnonymousAllowed(),
        };
    }

    public async setup(name: string, password: string): Promise<LoginResult> {
        this.ensureEnabled();
        // 初期セットアップは無認証で叩けるため、既にユーザーが居る場合は必ず拒否する
        if ((await this.db.count()) > 0) throw new Error('AuthIsAlreadyInitialized');
        // 最初のユーザーは必ずシステム管理者にする
        const user = await this.createUser(name, password, 'admin');
        return this.issue(user.id, user.name, user.role, 1);
    }

    public async login(name: string, password: string): Promise<LoginResult> {
        this.ensureEnabled();
        const user = typeof name === 'string' ? await this.db.findByName(name.trim()) : null;
        // ユーザー名の存在有無を応答から推測されないよう、どちらの失敗も同じエラーにする。
        // SSO だけで作られたユーザー (passwordHash が空) もここで弾かれる
        if (
            user === null ||
            user.passwordHash === '' ||
            verifyPassword(String(password ?? ''), user.passwordHash) === false
        ) {
            throw new Error('InvalidCredentials');
        }
        return this.issue(user.id, user.name, user.role, user.tokenVersion);
    }

    public async verify(token: string | null): Promise<SessionPayload | null> {
        const secret = this.getSigningKey();
        if (secret === null) return null;
        const payload = verifySessionToken(token, secret);
        if (payload === null) return null;

        // パスワード変更後の古いトークンを弾く
        const current = await this.getCurrentUser(payload.uid);
        if (current === null || current.version !== payload.ver) return null;
        // 権限は DB の現在値で上書きする (トークン発行後に変更されていても追随させる)
        return { ...payload, role: current.role };
    }

    public async listUsers(): Promise<AuthUserItem[]> {
        this.ensureEnabled();
        const users = await this.db.findAll();
        const identities = await Promise.all(users.map(x => this.db.listIdentities(x.id).catch(() => [])));
        return users.map((x, i) => ({
            id: x.id,
            name: x.name,
            role: AuthModel.toRole(x.role),
            hasPassword: x.passwordHash !== '',
            providers: identities[i].map(identity => identity.provider),
            createdAt: Number(x.createdAt),
        }));
    }

    public async addUser(name: string, password: string, role: string = 'user'): Promise<AuthUserItem> {
        this.ensureEnabled();
        const user = await this.createUser(name, password, role);
        return {
            id: user.id,
            name: user.name,
            role: AuthModel.toRole(user.role),
            hasPassword: true,
            providers: [],
            createdAt: Number(user.createdAt),
        };
    }

    public async setRole(id: number, role: string): Promise<void> {
        this.ensureEnabled();
        if (role !== 'admin' && role !== 'user') throw new Error('InvalidRole');
        const user = await this.db.findById(id);
        if (user === null) throw new Error('UserIsNotFound');
        if (user.role === role) return;
        // 管理者が 0 人になると設定変更もユーザー管理もできなくなるため降格を止める
        if (role === 'user' && (await this.db.countByRole('admin')) <= 1) throw new Error('LastAdminCanNotBeDemoted');
        await this.db.updateRole(id, role, Date.now());
        // 権限はキャッシュ経由で配るので、次の検証で読み直させる
        this.versionCache.delete(id);
    }

    /**
     * 外部 ID プロバイダ (Google / GitHub) 経由のログイン。
     * 紐付け済みならそのユーザーへログインし、未登録なら新規ユーザーを作る。
     * **最初のユーザーだけシステム管理者**とし、以降は一般権限にする
     */
    public async signInWithProvider(value: {
        provider: string;
        providerUserId: string;
        email: string | null;
        name: string;
    }): Promise<LoginResult> {
        this.ensureEnabled();
        const now = Date.now();
        const identity = await this.db.findIdentity(value.provider, value.providerUserId);
        if (identity !== null) {
            const user = await this.db.findById(identity.userId);
            if (user === null) throw new Error('UserIsNotFound');
            // メールアドレスは変わりうるので毎回上書きする
            await this.db.upsertIdentity({ ...value, userId: user.id, createdAt: now, updatedAt: now });
            return this.issue(user.id, user.name, user.role, user.tokenVersion);
        }

        const isFirstUser = (await this.db.count()) === 0;
        // 2 人目以降のサインアップを止めたい場合のスイッチ (既定は許可)
        if (isFirstUser === false && this.isSignUpAllowed() === false) throw new Error('SignUpIsNotAllowed');

        const created = await this.db.create({
            name: await this.buildUniqueName(value.name, value.email, value.provider),
            // SSO のみのユーザーはパスワードを持たない
            passwordHash: '',
            role: isFirstUser === true ? 'admin' : 'user',
            createdAt: now,
            updatedAt: now,
        });
        await this.db.upsertIdentity({ ...value, userId: created.id, createdAt: now, updatedAt: now });
        return this.issue(created.id, created.name, created.role, created.tokenVersion);
    }

    /**
     * 表示名の重複を避ける。同名が居たら 'name (google)' → 'name (google) 2' の順で試す
     */
    private async buildUniqueName(name: string, email: string | null, provider: string): Promise<string> {
        const base = (name || email || provider).trim().slice(0, AuthModel.MAX_NAME_LENGTH);
        if ((await this.db.findByName(base)) === null) return base;
        const withProvider = `${base} (${provider})`.slice(0, AuthModel.MAX_NAME_LENGTH);
        if ((await this.db.findByName(withProvider)) === null) return withProvider;
        for (let i = 2; i < 100; i++) {
            const candidate = `${withProvider} ${i}`.slice(0, AuthModel.MAX_NAME_LENGTH);
            if ((await this.db.findByName(candidate)) === null) return candidate;
        }
        throw new Error('UserNameIsAlreadyUsed');
    }

    private isSignUpAllowed(): boolean {
        return this.configuration.getConfig().auth?.allowSignUp !== false;
    }

    public async changePassword(id: number, newPassword: string, currentPassword?: string): Promise<void> {
        this.ensureEnabled();
        const user = await this.db.findById(id);
        if (user === null) throw new Error('UserIsNotFound');
        // 自分のパスワードを変えるときは現在のパスワードを要求する (乗っ取られたセッションでの変更を防ぐ)
        if (typeof currentPassword === 'string' && verifyPassword(currentPassword, user.passwordHash) === false) {
            throw new Error('InvalidCredentials');
        }
        assertValidPassword(newPassword);
        await this.db.updatePassword(id, hashPassword(newPassword), Date.now());
        this.versionCache.delete(id);
    }

    public async removeUser(id: number): Promise<void> {
        this.ensureEnabled();
        const user = await this.db.findById(id);
        if (user === null) throw new Error('UserIsNotFound');
        // 全員消すと誰もログインできなくなるため、最後の 1 人は残す
        if ((await this.db.count()) <= 1) throw new Error('LastUserCanNotBeRemoved');
        // 管理者が 0 人になる削除も止める
        if (user.role === 'admin' && (await this.db.countByRole('admin')) <= 1) {
            throw new Error('LastAdminCanNotBeRemoved');
        }
        await this.db.delete(id);
        this.versionCache.delete(id);
    }

    private async createUser(
        name: string,
        password: string,
        role: string,
    ): Promise<{ id: number; name: string; role: string; createdAt: number }> {
        const trimmed = typeof name === 'string' ? name.trim() : '';
        if (trimmed === '' || trimmed.length > AuthModel.MAX_NAME_LENGTH) throw new Error('InvalidUserName');
        assertValidPassword(password);
        if ((await this.db.findByName(trimmed)) !== null) throw new Error('UserNameIsAlreadyUsed');

        const now = Date.now();
        const created = await this.db.create({
            name: trimmed,
            passwordHash: hashPassword(password),
            role: role === 'admin' ? 'admin' : 'user',
            createdAt: now,
            updatedAt: now,
        });
        return { id: created.id, name: created.name, role: created.role, createdAt: Number(created.createdAt) };
    }

    private issue(uid: number, name: string, role: string, version: number): LoginResult {
        const secret = this.getSigningKey();
        if (secret === null) throw new Error('SigningKeyIsNotAvailable');
        const ttl = this.getSessionTtlMs();
        const normalizedRole = AuthModel.toRole(role);
        const token = createSessionToken(
            { uid, name, role: normalizedRole, exp: Date.now() + ttl, ver: version },
            secret,
        );
        this.versionCache.set(uid, { version, role: normalizedRole, at: Date.now() });
        return {
            token,
            maxAgeSec: Math.floor(ttl / 1000),
            user: { id: uid, name, role: normalizedRole, hasPassword: false, providers: [], createdAt: 0 },
        };
    }

    private async getCurrentUser(uid: number): Promise<{ version: number; role: string } | null> {
        const cached = this.versionCache.get(uid);
        if (typeof cached !== 'undefined' && Date.now() - cached.at < AuthModel.VERSION_CACHE_MS) {
            return { version: cached.version, role: cached.role };
        }
        const user = await this.db.findById(uid);
        if (user === null) {
            this.versionCache.delete(uid);
            return null;
        }
        const role = user.role === 'admin' ? 'admin' : 'user';
        this.versionCache.set(uid, { version: user.tokenVersion, role, at: Date.now() });
        return { version: user.tokenVersion, role };
    }

    private getSigningKey(): string | null {
        return this.crypto.getSigningKey(AuthModel.SIGNING_PURPOSE);
    }

    private getSessionTtlMs(): number {
        const value = this.configuration.getConfig().auth?.sessionTtlMs;
        if (typeof value !== 'number' || Number.isFinite(value) === false) return AuthModel.DEFAULT_SESSION_TTL_MS;
        return Math.min(Math.max(value, AuthModel.MIN_SESSION_TTL_MS), AuthModel.MAX_SESSION_TTL_MS);
    }

    private ensureEnabled(): void {
        if (this.isEnabled() === false) throw new Error('AuthIsDisabled');
    }
}
