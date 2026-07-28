import User from '../../db/entities/User';

export interface NewUser {
    name: string;
    passwordHash: string;
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
    delete(id: number): Promise<void>;
}
