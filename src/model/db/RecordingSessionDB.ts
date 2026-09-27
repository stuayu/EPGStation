import { inject, injectable } from 'inversify';
import RecordingAttempt from '../../db/entities/RecordingAttempt';
import RecordingSession from '../../db/entities/RecordingSession';
import IPromiseRetry from '../IPromiseRetry';
import IDBOperator from './IDBOperator';
import IRecordingSessionDB from './IRecordingSessionDB';

export const ORPHAN_RECORDING_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

@injectable()
export default class RecordingSessionDB implements IRecordingSessionDB {
    private op: IDBOperator;
    private promieRetry: IPromiseRetry;

    constructor(@inject('IDBOperator') op: IDBOperator, @inject('IPromiseRetry') promieRetry: IPromiseRetry) {
        this.op = op;
        this.promieRetry = promieRetry;
    }

    /** セッションを作成する */
    public async createSession(data: Partial<RecordingSession>): Promise<RecordingSession> {
        const connection = await this.op.getConnection();
        const repo = connection.getRepository(RecordingSession);
        const result = await this.promieRetry.run(() => repo.insert(data));
        return await repo.findOneByOrFail({ id: result.identifiers[0].id });
    }

    /** セッションを更新する */
    public async updateSession(id: number, values: Partial<RecordingSession>): Promise<void> {
        const connection = await this.op.getConnection();
        await this.promieRetry.run(() => connection.getRepository(RecordingSession).update({ id }, values));
    }

    /** 接続 attempt を作成する */
    public async createAttempt(data: Partial<RecordingAttempt>): Promise<RecordingAttempt> {
        const connection = await this.op.getConnection();
        const repo = connection.getRepository(RecordingAttempt);
        const result = await this.promieRetry.run(() => repo.insert(data));
        return await repo.findOneByOrFail({ id: result.identifiers[0].id });
    }

    /** 接続 attempt を更新する */
    public async updateAttempt(id: number, values: Partial<RecordingAttempt>): Promise<void> {
        const connection = await this.op.getConnection();
        await this.promieRetry.run(() => connection.getRepository(RecordingAttempt).update({ id }, values));
    }

    /** 状態でセッションを取得する */
    public async findByState(state: RecordingSession['state']): Promise<RecordingSession[]> {
        const connection = await this.op.getConnection();
        return await this.promieRetry.run(() =>
            connection.getRepository(RecordingSession).find({ where: { state }, order: { id: 'ASC' } }),
        );
    }

    /** 録画 ID に紐づくセッションを取得する */
    public async findByRecordedId(recordedId: number): Promise<RecordingSession[]> {
        const connection = await this.op.getConnection();
        return await this.promieRetry.run(() =>
            connection
                .getRepository(RecordingSession)
                .find({ where: { recordedId }, order: { createdAt: 'ASC', id: 'ASC' } }),
        );
    }

    /** セッションの attempt を番号順に取得する */
    public async findAttemptsBySessionId(sessionId: number): Promise<RecordingAttempt[]> {
        const connection = await this.op.getConnection();
        return await this.promieRetry.run(() =>
            connection.getRepository(RecordingAttempt).find({ where: { sessionId }, order: { attemptNo: 'ASC' } }),
        );
    }

    /** 複数セッションの attempt をまとめて番号順に取得する */
    public async findAttemptsBySessionIds(sessionIds: number[]): Promise<RecordingAttempt[]> {
        if (sessionIds.length === 0) return [];
        const connection = await this.op.getConnection();
        return await this.promieRetry.run(() =>
            connection
                .getRepository(RecordingAttempt)
                .createQueryBuilder('attempt')
                .where('attempt.sessionId IN (:...sessionIds)', { sessionIds })
                .orderBy('attempt.sessionId', 'ASC')
                .addOrderBy('attempt.attemptNo', 'ASC')
                .getMany(),
        );
    }

    /** recordedId がない古いセッションを削除する */
    public async deleteOrphanSessionsBefore(cutoff: number): Promise<number> {
        const connection = await this.op.getConnection();
        const result = await this.promieRetry.run(() =>
            connection
                .getRepository(RecordingSession)
                .createQueryBuilder()
                .delete()
                .where('recordedId IS NULL')
                .andWhere('createdAt < :cutoff', { cutoff })
                .execute(),
        );
        return result.affected ?? 0;
    }
}
