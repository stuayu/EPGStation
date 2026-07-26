import { inject, injectable } from 'inversify';
import { LessThanOrEqual } from 'typeorm';
import NotificationQueue from '../../db/entities/NotificationQueue';
import IDBOperator from './IDBOperator';
import INotificationQueueDB, { MarkFailedOption, NewNotificationQueueItem } from './INotificationQueueDB';

@injectable()
export default class NotificationQueueDB implements INotificationQueueDB {
    constructor(@inject('IDBOperator') private readonly op: IDBOperator) {}

    public async enqueue(value: NewNotificationQueueItem): Promise<NotificationQueue> {
        const c = await this.op.getConnection();
        const repo = c.getRepository(NotificationQueue);
        return await repo.save(
            repo.create({
                targetName: value.targetName,
                eventType: value.eventType,
                payload: value.payload,
                status: 'pending',
                attempts: 0,
                nextAttemptAt: value.nextAttemptAt,
                lastError: null,
                createdAt: value.now,
                updatedAt: value.now,
            }),
        );
    }

    public async findDue(now: number, limit: number): Promise<NotificationQueue[]> {
        const c = await this.op.getConnection();
        return await c.getRepository(NotificationQueue).find({
            where: { status: 'pending', nextAttemptAt: LessThanOrEqual(now) },
            order: { nextAttemptAt: 'ASC' },
            take: limit,
        });
    }

    public async markSent(id: number, now: number): Promise<void> {
        const c = await this.op.getConnection();
        await c.getRepository(NotificationQueue).update({ id }, { status: 'sent', updatedAt: now });
    }

    public async markFailed(id: number, option: MarkFailedOption): Promise<void> {
        const c = await this.op.getConnection();
        await c.getRepository(NotificationQueue).update(
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

    public async listFailed(limit = 50): Promise<NotificationQueue[]> {
        const c = await this.op.getConnection();
        return await c.getRepository(NotificationQueue).find({
            where: { status: 'failed' },
            order: { updatedAt: 'DESC' },
            take: limit,
        });
    }
}
