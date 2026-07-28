import * as apid from '../../../api';
import { SessionPayload } from './SessionToken';

export type AuthStatus = apid.AuthStatus;
export type AuthUserItem = apid.AuthUserItem;

export interface LoginResult {
    token: string;
    // Cookie の Max-Age に使う秒数
    maxAgeSec: number;
    user: AuthUserItem;
}

export default interface IAuthModel {
    /**
     * 認証が有効か (config.yml の auth.enabled)
     * @return boolean
     */
    isEnabled(): boolean;
    /**
     * ログインしていない利用者にも一般ユーザーと同じ操作を許可するか
     * (システム管理者向けの操作は許可しない)
     * @return boolean
     */
    isAnonymousAllowed(): boolean;
    /**
     * 認証状態 (有効か / 初期ユーザー作成済みか / ログイン中のユーザー)
     * @param token: string | null Cookie から取り出したセッショントークン
     * @return Promise<AuthStatus>
     */
    getStatus(token: string | null): Promise<AuthStatus>;
    /**
     * 初期ユーザーを作成する (ユーザーが 1 人も居ないときだけ許可)
     * @param name: string
     * @param password: string
     * @return Promise<LoginResult> 作成後そのままログインさせる
     */
    setup(name: string, password: string): Promise<LoginResult>;
    /**
     * ログインしてセッショントークンを発行する
     * @param name: string
     * @param password: string
     * @return Promise<LoginResult>
     */
    login(name: string, password: string): Promise<LoginResult>;
    /**
     * セッショントークンを検証する。無効なら null
     * @param token: string | null
     * @return Promise<SessionPayload | null>
     */
    verify(token: string | null): Promise<SessionPayload | null>;
    /**
     * 外部プレイヤー・IPTV クライアント向けのアクセストークンを発行する。
     * これらは Cookie を送れないため、URL のクエリに載せて認証する
     * @param payload: SessionPayload ログイン中のユーザー
     * @return string | null 署名鍵が無ければ null
     */
    createMediaToken(payload: SessionPayload): string | null;
    /**
     * 外部プレイヤー向けトークンを検証する
     * @param token: string | null
     * @return Promise<SessionPayload | null>
     */
    verifyMediaToken(token: string | null): Promise<SessionPayload | null>;
    /**
     * ユーザー一覧 (パスワード情報は含まない)
     * @return Promise<AuthUserItem[]>
     */
    listUsers(): Promise<AuthUserItem[]>;
    addUser(name: string, password: string, role?: string): Promise<AuthUserItem>;
    /**
     * 権限を変更する ('admin' | 'user')。最後のシステム管理者は降格できない
     * @param id: number
     * @param role: string
     * @return Promise<void>
     */
    setRole(id: number, role: string): Promise<void>;
    /**
     * 外部 ID プロバイダ経由でログインする。未登録なら新規ユーザーを作る
     * (最初のユーザーのみシステム管理者、以降は一般権限)
     * @param value: プロバイダから取得した識別情報
     * @return Promise<LoginResult>
     */
    signInWithProvider(value: {
        provider: string;
        providerUserId: string;
        email: string | null;
        name: string;
    }): Promise<LoginResult>;
    /**
     * パスワードを変更する。自分のパスワードを変える場合は現在のパスワードを要求する
     * @param id: number
     * @param newPassword: string
     * @param currentPassword?: string
     * @return Promise<void>
     */
    changePassword(id: number, newPassword: string, currentPassword?: string): Promise<void>;
    /**
     * ユーザーを削除する (最後の 1 人は削除できない = ログイン不能を防ぐ)
     * @param id: number
     * @return Promise<void>
     */
    removeUser(id: number): Promise<void>;
}
