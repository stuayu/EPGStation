import User from '../../db/entities/User';
import UserIdentity from '../../db/entities/UserIdentity';

export interface NewUser {
    name: string;
    // SSO だけで作られるユーザーは空文字 (パスワードログイン不可)
    passwordHash: string;
    // 'admin' | 'user'
    role: string;
    createdAt: number;
    updatedAt: number;
}

export interface NewUserIdentity {
    userId: number;
    provider: string;
    providerUserId: string;
    email: string | null;
    createdAt: number;
    updatedAt: number;
}

export default interface IUserDB {
    /**
     * 登録ユーザー数 (初期セットアップが必要かの判定に使う)
     * @return Promise<number>
     */
    count(): Promise<number>;
    /**
     * 全ユーザーを名前順で返す
     * @return Promise<User[]>
     */
    findAll(): Promise<User[]>;
    findById(id: number): Promise<User | null>;
    findByName(name: string): Promise<User | null>;
    create(value: NewUser): Promise<User>;
    /**
     * パスワードを差し替え、tokenVersion を進めて既存セッションを失効させる
     * @param id: number
     * @param passwordHash: string
     * @param updatedAt: number
     * @return Promise<User>
     */
    updatePassword(id: number, passwordHash: string, updatedAt: number): Promise<User>;
    /**
     * 権限を変更する (システム管理者 / 一般)
     * @param id: number
     * @param role: string 'admin' | 'user'
     * @param updatedAt: number
     * @return Promise<User>
     */
    updateRole(id: number, role: string, updatedAt: number): Promise<User>;
    /**
     * 指定した権限のユーザー数 (最後の管理者を降格・削除させないために使う)
     * @param role: string
     * @return Promise<number>
     */
    countByRole(role: string): Promise<number>;
    delete(id: number): Promise<void>;

    /**
     * 外部 ID プロバイダの識別子からユーザーを引く
     * @param provider: string
     * @param providerUserId: string
     * @return Promise<UserIdentity | null>
     */
    findIdentity(provider: string, providerUserId: string): Promise<UserIdentity | null>;
    /**
     * ユーザーに紐付いた外部 ID 一覧
     * @param userId: number
     * @return Promise<UserIdentity[]>
     */
    listIdentities(userId: number): Promise<UserIdentity[]>;
    /**
     * 外部 ID の紐付けを作成 / 更新する (メールアドレスは変わりうるので毎回更新する)
     * @param value: NewUserIdentity
     * @return Promise<UserIdentity>
     */
    upsertIdentity(value: NewUserIdentity): Promise<UserIdentity>;
}
