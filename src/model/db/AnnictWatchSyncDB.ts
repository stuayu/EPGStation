import { inject, injectable } from 'inversify';
import { LessThanOrEqual } from 'typeorm';
import AnnictWatchSync from '../../db/entities/AnnictWatchSync';
import IAnnictWatchSyncDB, { MarkFailedOption, NewAnnictWatchSync } from './IAnnictWatchSyncDB';
import IDBOperator from './IDBOperator';
@injectable()
export default class AnnictWatchSyncDB implements IAnnictWatchSyncDB {
    constructor(@inject('IDBOperator') private readonly op: IDBOperator) {}
    public async enqueue(value: NewAnnictWatchSync): Promise<AnnictWatchSync | null> {
        const c = await this.op.getConnection();
        const repo = c.getRepository(AnnictWatchSync);
        const current = await repo.findOne({
            where: { seriesId: value.seriesId, seriesEpisodeId: value.seriesEpisodeId },
        });
        if (current) {
            // 既に送信済みなら何もしない (二重送信防止)
            if (current.status === 'sent') return current;
            current.status = 'pending';
            current.nextAttemptAt = value.now;
            current.annictWorkId = value.annictWorkId;
            current.episodeNumber = value.episodeNumber;
            current.updatedAt = value.now;
            return await repo.save(current);
        }
        return await repo.save(
            repo.create({
                recordedId: value.recordedId,
                seriesId: value.seriesId,
                seriesEpisodeId: value.seriesEpisodeId,
                annictWorkId: value.annictWorkId,
                episodeNumber: value.episodeNumber,
                status: 'pending',
                attempts: 0,
                nextAttemptAt: value.now,
                lastError: null,
                createdAt: value.now,
                updatedAt: value.now,
            }),
        );
    }
    public async findDue(now: number, limit: number): Promise<AnnictWatchSync[]> {
        const c = await this.op.getConnection();
        return await c.getRepository(AnnictWatchSync).find({
            where: { status: 'pending', nextAttemptAt: LessThanOrEqual(now) },
            order: { nextAttemptAt: 'ASC' },
            take: limit,
        });
    }
    public async markSent(id: number, now: number): Promise<void> {
        const c = await this.op.getConnection();
        await c.getRepository(AnnictWatchSync).update({ id }, { status: 'sent', updatedAt: now });
    }
    public async markFailed(id: number, option: MarkFailedOption): Promise<void> {
        const c = await this.op.getConnection();
        await c.getRepository(AnnictWatchSync).update(
            { id },
            {
                status: option.terminal ? 'failed' : 'pending',
                attempts: option.attempts,
                nextAttemptAt: option.nextAttemptAt,
                lastError: option.lastError,
                updatedAt: option.nextAttemptAt,
            },
        );
    }
    public async findBySeriesId(seriesId: number): Promise<AnnictWatchSync[]> {
        const c = await this.op.getConnection();
        return await c.getRepository(AnnictWatchSync).find({ where: { seriesId } });
    }
}
