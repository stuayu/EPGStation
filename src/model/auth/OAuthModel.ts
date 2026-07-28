import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import ISecretCrypto from '../security/ISecretCrypto';
import IAuthModel, { LoginResult } from './IAuthModel';
import IOAuthModel from './IOAuthModel';
import {
    buildAuthorizeUrl,
    createOAuthState,
    extractProfile,
    OAUTH_PROVIDER_IDS,
    OAUTH_PROVIDERS,
    OAuthProviderId,
    verifyOAuthState,
} from './OAuthProviders';

interface ProviderCredential {
    clientId: string;
    clientSecret: string;
}

/**
 * Google / GitHub の OAuth 2.0 認可コードフロー。
 * クライアント ID / シークレットは config.yml の auth.providers に置く
 * (ログイン前に必要なので DB (app_setting) からは読めないため)
 */
@injectable()
export default class OAuthModel implements IOAuthModel {
    // state の有効期間 (認可画面での操作時間を見込んで 10 分)
    private static readonly STATE_TTL_MS = 10 * 60 * 1000;
    private static readonly SIGNING_PURPOSE = 'oauth-state';
    private static readonly REQUEST_TIMEOUT_MS = 15 * 1000;

    private log: ILogger;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') private configuration: IConfiguration,
        @inject('IAuthModel') private authModel: IAuthModel,
        @inject('ISecretCrypto') private crypto: ISecretCrypto,
    ) {
        this.log = logger.getLogger();
    }

    public listProviders(baseUrl: string): apid.AuthProviderItem[] {
        const result: apid.AuthProviderItem[] = [];
        for (const id of OAUTH_PROVIDER_IDS) {
            if (this.getCredential(id) === null) continue;
            result.push({
                id,
                label: OAUTH_PROVIDERS[id].label,
                authorizeUrl: `${this.getApiBase(baseUrl)}/auth/oauth/${id}`,
            });
        }
        return result;
    }

    /**
     * subDirectory 運用でも正しい URL になるよう API のベースを組み立てる
     */
    private getApiBase(baseUrl: string): string {
        const sub = this.configuration.getConfig().subDirectory;
        const prefix = typeof sub === 'string' && sub !== '' ? (sub.startsWith('/') ? sub : `/${sub}`) : '';
        return `${baseUrl}${prefix}/api`;
    }

    public createAuthorizeUrl(provider: OAuthProviderId, baseUrl: string): string {
        const credential = this.getCredential(provider);
        if (credential === null) throw new Error('OAuthProviderIsNotConfigured');
        const secret = this.getStateKey();
        const state = createOAuthState(provider, secret, OAuthModel.STATE_TTL_MS);
        return buildAuthorizeUrl(provider, credential.clientId, this.getRedirectUri(provider, baseUrl), state);
    }

    public async handleCallback(
        provider: OAuthProviderId,
        code: string,
        state: string,
        baseUrl: string,
    ): Promise<LoginResult> {
        const credential = this.getCredential(provider);
        if (credential === null) throw new Error('OAuthProviderIsNotConfigured');
        if (typeof code !== 'string' || code === '') throw new Error('InvalidOAuthCode');
        // state を検証しないと、攻撃者のアカウントでログインさせられる (CSRF)
        if (verifyOAuthState(state, provider, this.getStateKey()) === null) throw new Error('InvalidOAuthState');

        const redirectUri = this.getRedirectUri(provider, baseUrl);
        const accessToken = await this.exchangeCode(provider, credential, code, redirectUri);
        const profile = await this.fetchProfile(provider, accessToken);
        if (profile === null) throw new Error('OAuthProfileIsNotAvailable');

        return await this.authModel.signInWithProvider({ provider, ...profile });
    }

    /**
     * 認可コードをアクセストークンに交換する
     */
    private async exchangeCode(
        provider: OAuthProviderId,
        credential: ProviderCredential,
        code: string,
        redirectUri: string,
    ): Promise<string> {
        const response = await this.request(OAUTH_PROVIDERS[provider].tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                // GitHub は既定でフォーム形式を返すため JSON を明示的に要求する
                Accept: 'application/json',
                'User-Agent': 'EPGStation',
            },
            body: new URLSearchParams({
                client_id: credential.clientId,
                client_secret: credential.clientSecret,
                code,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }).toString(),
        });
        const token = response?.access_token;
        if (typeof token !== 'string' || token === '') {
            this.log.system.warn(`oauth token exchange failed: ${JSON.stringify(response).slice(0, 200)}`);
            throw new Error('OAuthTokenExchangeFailed');
        }
        return token;
    }

    /**
     * アクセストークンでプロフィールを取得する
     */
    private async fetchProfile(
        provider: OAuthProviderId,
        accessToken: string,
    ): Promise<{ providerUserId: string; email: string | null; name: string } | null> {
        const headers = {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            'User-Agent': 'EPGStation',
        };
        const profile = await this.request(OAUTH_PROVIDERS[provider].userInfoUrl, { method: 'GET', headers });

        // GitHub はメール非公開設定だとプロフィールに載らないため別途取得する
        let emails: unknown;
        if (provider === 'github' && (profile === null || typeof profile.email !== 'string')) {
            emails = await this.request('https://api.github.com/user/emails', { method: 'GET', headers }).catch(
                () => undefined,
            );
        }
        return extractProfile(provider, profile, emails);
    }

    private async request(url: string, init: RequestInit): Promise<any> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), OAuthModel.REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(url, { ...init, signal: controller.signal });
            const text = await response.text();
            if (response.ok === false) {
                this.log.system.warn(`oauth request failed (${response.status}): ${text.slice(0, 200)}`);
                throw new Error('OAuthRequestFailed');
            }
            return text === '' ? null : JSON.parse(text);
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * コールバック URL。プロバイダ側の設定と一致させる必要がある
     */
    private getRedirectUri(provider: OAuthProviderId, baseUrl: string): string {
        const configured = this.configuration.getConfig().auth?.providers?.[provider]?.redirectUri;
        if (typeof configured === 'string' && configured !== '') return configured;
        return `${this.getApiBase(baseUrl)}/auth/oauth/${provider}/callback`;
    }

    private getCredential(provider: OAuthProviderId): ProviderCredential | null {
        const value = this.configuration.getConfig().auth?.providers?.[provider];
        const clientId = value?.clientId;
        const clientSecret = value?.clientSecret;
        if (typeof clientId !== 'string' || clientId === '') return null;
        if (typeof clientSecret !== 'string' || clientSecret === '') return null;
        return { clientId, clientSecret };
    }

    private getStateKey(): string {
        const key = this.crypto.getSigningKey(OAuthModel.SIGNING_PURPOSE);
        if (key === null) throw new Error('SigningKeyIsNotAvailable');
        return key;
    }
}
