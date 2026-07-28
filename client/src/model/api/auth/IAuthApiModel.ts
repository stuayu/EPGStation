import * as apid from '../../../../../api';

export type AuthStatus = apid.AuthStatus;
export type AuthUserItem = apid.AuthUserItem;

export default interface IAuthApiModel {
    /**
     * 認証状態を取得する (認証不要)
     * @return Promise<AuthStatus>
     */
    getStatus(): Promise<AuthStatus>;
    /**
     * 初期ユーザーを作成してログインする
     */
    setup(name: string, password: string): Promise<void>;
    login(name: string, password: string): Promise<void>;
    logout(): Promise<void>;
    /**
     * 外部プレイヤー・IPTV 用のアクセストークンを取得する (認証無効時は null)
     */
    getMediaToken(): Promise<string | null>;
    listUsers(): Promise<AuthUserItem[]>;
    addUser(name: string, password: string): Promise<AuthUserItem>;
    /**
     * パスワードを変更する (自分のパスワードを変える場合は currentPassword が必要)
     */
    changePassword(userId: number, newPassword: string, currentPassword?: string): Promise<void>;
    removeUser(userId: number): Promise<void>;
    /**
     * 権限 (システム管理者 / 一般) を変更する
     */
    setRole(userId: number, role: apid.AuthRole): Promise<void>;
}
