import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IAuthApiModel, { AuthStatus, AuthUserItem } from './IAuthApiModel';

@injectable()
export default class AuthApiModel implements IAuthApiModel {
    constructor(@inject('IRepositoryModel') private repository: IRepositoryModel) {}

    public async getStatus(): Promise<AuthStatus> {
        return (await this.repository.get('/auth')).data;
    }
    public async setup(name: string, password: string): Promise<void> {
        await this.repository.post('/auth/setup', { name, password });
    }
    public async login(name: string, password: string): Promise<void> {
        await this.repository.post('/auth/login', { name, password });
    }
    public async logout(): Promise<void> {
        await this.repository.post('/auth/logout', {});
    }
    public async getMediaToken(): Promise<string | null> {
        return (await this.repository.get('/auth/media-token')).data?.token ?? null;
    }
    public async listUsers(): Promise<AuthUserItem[]> {
        return (await this.repository.get('/auth/users')).data;
    }
    public async addUser(name: string, password: string): Promise<AuthUserItem> {
        return (await this.repository.post('/auth/users', { name, password })).data;
    }
    public async changePassword(userId: number, newPassword: string, currentPassword?: string): Promise<void> {
        await this.repository.put(`/auth/users/${userId}`, { newPassword, currentPassword });
    }
    public async removeUser(userId: number): Promise<void> {
        await this.repository.delete(`/auth/users/${userId}`);
    }
    public async setRole(userId: number, role: apid.AuthRole): Promise<void> {
        await this.repository.put(`/auth/users/${userId}/role`, { role });
    }
}
