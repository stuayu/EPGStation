import { inject, injectable } from 'inversify';
import { LessThan } from 'typeorm';
import MetadataProviderCache from '../../db/entities/MetadataProviderCache';
import IDBOperator from './IDBOperator';
import IMetadataProviderCacheDB from './IMetadataProviderCacheDB';
@injectable()
export default class MetadataProviderCacheDB implements IMetadataProviderCacheDB {
    constructor(@inject('IDBOperator') private op: IDBOperator) {}
    async get(provider: string, externalId: string) {
        const c = await this.op.getConnection();
        return await c.getRepository(MetadataProviderCache).findOne({ where: { provider, externalId } });
    }
    async put(provider: string, externalId: string, payload: unknown, etag: string | null, expiresAt: number) {
        const c = await this.op.getConnection();
        const repo = c.getRepository(MetadataProviderCache);
        const current = await repo.findOne({ where: { provider, externalId } });
        await repo.save(
            repo.create({
                ...current,
                provider,
                externalId,
                payload: JSON.stringify(payload),
                etag,
                expiresAt,
                updatedAt: Date.now(),
            }),
        );
    }
    async deleteExpired(now: number) {
        const c = await this.op.getConnection();
        await c.getRepository(MetadataProviderCache).delete({ expiresAt: LessThan(now) });
    }
}
