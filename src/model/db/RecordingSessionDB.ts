import { inject, injectable } from 'inversify';
import RecordingAttempt from '../../db/entities/RecordingAttempt';
import RecordingSession from '../../db/entities/RecordingSession';
import IPromiseRetry from '../IPromiseRetry';
import IDBOperator from './IDBOperator';
import IRecordingSessionDB, { RecordingResultQuery } from './IRecordingSessionDB';

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

    /** 録画結果を条件で絞り込み、予定時刻の降順で取得する */
    public async findRecordingResults(
        query: RecordingResultQuery,
    ): Promise<{ items: RecordingSession[]; total: number }> {
        const connection = await this.op.getConnection();
        const qb = connection.getRepository(RecordingSession).createQueryBuilder('session');
        if (query.result !== undefined) {
            qb.andWhere('session.resultStatus = :result', { result: query.result });
        } else {
            qb.andWhere('session.resultStatus IS NOT NULL');
        }
        if (query.from !== undefined) qb.andWhere('session.scheduledStartAt >= :from', { from: query.from });
        if (query.to !== undefined) qb.andWhere('session.scheduledStartAt <= :to', { to: query.to });
        if (query.ruleId !== undefined) qb.andWhere('session.ruleId = :ruleId', { ruleId: query.ruleId });
        if (query.keyword !== undefined && query.keyword.trim() !== '') {
            qb.andWhere(`session.name ${this.op.getLikeStr(false)} :keyword`, { keyword: `%${query.keyword.trim()}%` });
        }
        const [items, total] = await this.promieRetry.run(() =>
            qb
                .orderBy('session.scheduledStartAt', 'DESC')
                .addOrderBy('session.id', 'DESC')
                .skip(query.offset)
                .take(query.limit)
                .getManyAndCount(),
        );
        return { items, total };
    }

    /** ID でセッションを取得する */
    public async findById(id: number): Promise<RecordingSession | null> {
        const connection = await this.op.getConnection();
        return (await this.promieRetry.run(() => connection.getRepository(RecordingSession).findOneBy({ id }))) ?? null;
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
