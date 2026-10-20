import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import ClientSetting from '../../../db/entities/ClientSetting';
import IDBOperator from '../../db/IDBOperator';
import IClientSettingsApiModel from './IClientSettingsApiModel';

@injectable()
export default class ClientSettingsApiModel implements IClientSettingsApiModel {
    private readonly putTails = new Map<number, Promise<void>>();

    constructor(@inject('IDBOperator') private readonly dbOperator: IDBOperator) {}

    /** クライアント設定を取得する */
    public async get(userId: number | null): Promise<apid.ClientSettingsResponse> {
        const repository = (await this.dbOperator.getConnection()).getRepository(ClientSetting);
        const entity = await repository.findOneBy({ userId: userId ?? 0 });
        return entity === null ? { settings: {}, updatedAt: 0 } : this.toResponse(entity);
    }

    /** クライアント設定を保存し、競合時はサーバー側の値を返す */
    public async put(
        userId: number | null,
        settings: Record<string, unknown>,
        baseUpdatedAt: number,
    ): Promise<apid.ClientSettingsResponse> {
        const normalizedUserId = userId ?? 0;
        const previous = this.putTails.get(normalizedUserId) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>(resolve => (release = resolve));
        const tail = previous.then(() => current);
        this.putTails.set(normalizedUserId, tail);
        await previous;
        try {
            return await this.putTransaction(normalizedUserId, settings, baseUpdatedAt);
        } finally {
            release();
            if (this.putTails.get(normalizedUserId) === tail) this.putTails.delete(normalizedUserId);
        }
    }

    private async putTransaction(
        normalizedUserId: number,
        settings: Record<string, unknown>,
        baseUpdatedAt: number,
    ): Promise<apid.ClientSettingsResponse> {
        const connection = await this.dbOperator.getConnection();
        return connection.transaction(async manager => {
            const repository = manager.getRepository(ClientSetting);
            const entity = await repository.findOneBy({ userId: normalizedUserId });
            if (entity !== null && entity.updatedAt > baseUpdatedAt) {
                throw Object.assign(new Error('ClientSettingsConflict'), { response: this.toResponse(entity) });
            }

            const saved = entity ?? repository.create({ userId: normalizedUserId });
            saved.settings = JSON.stringify(settings);
            saved.updatedAt = Math.max(Date.now(), baseUpdatedAt + 1);
            return this.toResponse(await repository.save(saved));
        });
    }

    private toResponse(entity: ClientSetting): apid.ClientSettingsResponse {
        return { settings: JSON.parse(entity.settings) as Record<string, unknown>, updatedAt: entity.updatedAt };
    }
}
