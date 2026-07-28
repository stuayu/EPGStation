import { inject, injectable } from 'inversify';
import User from '../../db/entities/User';
import IDBOperator from './IDBOperator';
import UserIdentity from '../../db/entities/UserIdentity';
import IUserDB, { NewUser, NewUserIdentity } from './IUserDB';

@injectable()
export default class UserDB implements IUserDB {
    constructor(@inject('IDBOperator') private op: IDBOperator) {}

    public async count(): Promise<number> {
        const c = await this.op.getConnection();
        return await c.getRepository(User).count();
    }

    public async findAll(): Promise<User[]> {
        const c = await this.op.getConnection();
        return await c.getRepository(User).find({ order: { name: 'ASC' } });
    }

    public async findById(id: number): Promise<User | null> {
        const c = await this.op.getConnection();
        return await c.getRepository(User).findOne({ where: { id } });
    }

    public async findByName(name: string): Promise<User | null> {
        const c = await this.op.getConnection();
        return await c.getRepository(User).findOne({ where: { name } });
    }

    public async create(value: NewUser): Promise<User> {
        const c = await this.op.getConnection();
        const repo = c.getRepository(User);
        return await repo.save(repo.create({ ...value, tokenVersion: 1 }));
    }

    public async updateRole(id: number, role: string, updatedAt: number): Promise<User> {
        const c = await this.op.getConnection();
        const repo = c.getRepository(User);
        const current = await repo.findOne({ where: { id } });
        if (current === null) throw new Error('UserIsNotFound');
        return await repo.save(repo.create({ ...current, role, updatedAt }));
    }

    public async countByRole(role: string): Promise<number> {
        const c = await this.op.getConnection();
        return await c.getRepository(User).count({ where: { role } });
    }

    public async findIdentity(provider: string, providerUserId: string): Promise<UserIdentity | null> {
        const c = await this.op.getConnection();
        return await c.getRepository(UserIdentity).findOne({ where: { provider, providerUserId } });
    }

    public async listIdentities(userId: number): Promise<UserIdentity[]> {
        const c = await this.op.getConnection();
        return await c.getRepository(UserIdentity).find({ where: { userId }, order: { provider: 'ASC' } });
    }

    public async upsertIdentity(value: NewUserIdentity): Promise<UserIdentity> {
        const c = await this.op.getConnection();
        const repo = c.getRepository(UserIdentity);
        const current = await repo.findOne({
            where: { provider: value.provider, providerUserId: value.providerUserId },
        });
        return await repo.save(repo.create({ ...current, ...value, createdAt: current?.createdAt ?? value.createdAt }));
    }

    public async updatePassword(id: number, passwordHash: string, updatedAt: number): Promise<User> {
        const c = await this.op.getConnection();
        const repo = c.getRepository(User);
        const current = await repo.findOne({ where: { id } });
        if (current === null) throw new Error('UserIsNotFound');
        // tokenVersion を進めることで、パスワード変更前に発行したセッションを一括で失効させる
        return await repo.save(
            repo.create({ ...current, passwordHash, tokenVersion: current.tokenVersion + 1, updatedAt }),
        );
    }

    public async delete(id: number): Promise<void> {
        const c = await this.op.getConnection();
        // 紐付いた外部 ID も一緒に消す (残すと同じアカウントで再ログインした際に迷子になる)
        await c.getRepository(UserIdentity).delete({ userId: id });
        await c.getRepository(User).delete({ id });
    }
}
