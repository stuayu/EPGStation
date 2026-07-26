import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
export type NotificationQueueStatus = 'pending' | 'sent' | 'failed';
/**
 * 通知の永続リトライキュー (§7.3)。即時配信に失敗した通知はここに積まれ、
 * 指数バックオフで最大 maxAttempts 回まで再試行される。Service プロセスの再起動をまたいでも
 * 再送が継続される (NotificationQueueModel が起動時に findDue() から再開する)
 */
@Entity({ name: 'notification_queue' })
@Index('IDX_notification_queue_status', ['status', 'nextAttemptAt'])
export default class NotificationQueue extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) public id!: number;
    @Column({ type: 'varchar', length: 191 }) public targetName!: string;
    @Column({ type: 'varchar', length: 50 }) public eventType!: string;
    @Column({ type: 'text' }) public payload!: string;
    @Column({ type: 'varchar', length: 20, default: 'pending' }) public status: NotificationQueueStatus = 'pending';
    @Column({ type: 'integer', default: 0 }) public attempts = 0;
    @Column({ type: 'bigint' }) public nextAttemptAt!: number;
    @Column({ type: 'text', nullable: true }) public lastError!: string | null;
    @Column({ type: 'bigint' }) public createdAt!: number;
    @Column({ type: 'bigint' }) public updatedAt!: number;
}
