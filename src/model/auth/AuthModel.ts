import { inject, injectable } from 'inversify';
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
    // tokenVersion の照合で毎リクエスト DB を引かないためのキャッシュ保持時間
    private static readonly VERSION_CACHE_MS = 30 * 1000;
    private static readonly MAX_NAME_LENGTH = 64;

    private versionCache = new Map<number, { version: number; at: number }>();

    constructor(
        @inject('IConfiguration') private configuration: IConfiguration,
        @inject('IUserDB') private db: IUserDB,
        @inject('ISecretCrypto') private crypto: ISecretCrypto,
    ) {}

    public isEnabled(): boolean {
        return this.configuration.getConfig().auth?.enabled === true;
    }

    public async getStatus(token: string | null): Promise<AuthStatus> {
        const enabled = this.isEnabled();
        if (enabled === false) {
            return { enabled: false, initialized: true, user: null };
        }
        const initialized = (await this.db.count()) > 0;
        const payload = initialized === true ? await this.verify(token) : null;
        return {
            enabled: true,
            initialized,
            user: payload === null ? null : { id: payload.uid, name: payload.name },
        };
    }

    public async setup(name: string, password: string): Promise<LoginResult> {
        this.ensureEnabled();
        // 初期セットアップは無認証で叩けるため、既にユーザーが居る場合は必ず拒否する
        if ((await this.db.count()) > 0) throw new Error('AuthIsAlreadyInitialized');
        const user = await this.createUser(name, password);
        return this.issue(user.id, user.name, 1);
    }

    public async login(name: string, password: string): Promise<LoginResult> {
        this.ensureEnabled();
        const user = typeof name === 'string' ? await this.db.findByName(name.trim()) : null;
        // ユーザー名の存在有無を応答から推測されないよう、どちらの失敗も同じエラーにする
        if (user === null || verifyPassword(String(password ?? ''), user.passwordHash) === false) {
            throw new Error('InvalidCredentials');
        }
        return this.issue(user.id, user.name, user.tokenVersion);
    }

    public async verify(token: string | null): Promise<SessionPayload | null> {
        const secret = this.getSigningKey();
        if (secret === null) return null;
        const payload = verifySessionToken(token, secret);
        if (payload === null) return null;

        // パスワード変更後の古いトークンを弾く
        const version = await this.getTokenVersion(payload.uid);
        if (version === null || version !== payload.ver) return null;
        return payload;
    }

    public async listUsers(): Promise<AuthUserItem[]> {
        this.ensureEnabled();
        return (await this.db.findAll()).map(x => ({ id: x.id, name: x.name, createdAt: Number(x.createdAt) }));
    }

    public async addUser(name: string, password: string): Promise<AuthUserItem> {
        this.ensureEnabled();
        const user = await this.createUser(name, password);
        return { id: user.id, name: user.name, createdAt: Number(user.createdAt) };
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
        await this.db.delete(id);
        this.versionCache.delete(id);
    }

    private async createUser(name: string, password: string): Promise<{ id: number; name: string; createdAt: number }> {
        const trimmed = typeof name === 'string' ? name.trim() : '';
        if (trimmed === '' || trimmed.length > AuthModel.MAX_NAME_LENGTH) throw new Error('InvalidUserName');
        assertValidPassword(password);
        if ((await this.db.findByName(trimmed)) !== null) throw new Error('UserNameIsAlreadyUsed');

        const now = Date.now();
        const created = await this.db.create({
            name: trimmed,
            passwordHash: hashPassword(password),
            createdAt: now,
            updatedAt: now,
        });
        return { id: created.id, name: created.name, createdAt: Number(created.createdAt) };
    }

    private issue(uid: number, name: string, version: number): LoginResult {
        const secret = this.getSigningKey();
        if (secret === null) throw new Error('SigningKeyIsNotAvailable');
        const ttl = this.getSessionTtlMs();
        const token = createSessionToken({ uid, name, exp: Date.now() + ttl, ver: version }, secret);
        this.versionCache.set(uid, { version, at: Date.now() });
        return { token, maxAgeSec: Math.floor(ttl / 1000), user: { id: uid, name, createdAt: 0 } };
    }

    private async getTokenVersion(uid: number): Promise<number | null> {
        const cached = this.versionCache.get(uid);
        if (typeof cached !== 'undefined' && Date.now() - cached.at < AuthModel.VERSION_CACHE_MS) {
            return cached.version;
        }
        const user = await this.db.findById(uid);
        if (user === null) {
            this.versionCache.delete(uid);
            return null;
        }
        this.versionCache.set(uid, { version: user.tokenVersion, at: Date.now() });
        return user.tokenVersion;
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
