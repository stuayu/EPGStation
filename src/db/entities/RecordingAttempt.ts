import { BaseEntity, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import RecordingSession from './RecordingSession';

@Entity()
@Index(['sessionId', 'attemptNo'], { unique: true })
export default class RecordingAttempt extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' })
    public id!: number;

    @Column({ type: 'integer' })
    public sessionId!: number;

    @Column({ type: 'integer' })
    public attemptNo!: number;

    @Column({ type: 'bigint' })
    public requestedAt!: number;

    @Column({ type: 'bigint', nullable: true })
    public firstDataAt!: number | null;

    @Column({ type: 'bigint', nullable: true })
    public endedAt!: number | null;

    @Column({ type: 'text', nullable: true })
    public closeReason!: string | null;

    @Column({ type: 'text', nullable: true })
    public errorCode!: string | null;

    @Column({ type: 'integer' })
    public priority!: number;

    @Column({ type: 'bigint', default: 0 })
    public bytesReceived!: number;

    @Column({ type: 'bigint', nullable: true })
    public fileOffsetStart!: number | null;

    @Column({ type: 'bigint', nullable: true })
    public fileOffsetEnd!: number | null;

    @ManyToOne(() => RecordingSession, session => session.attempts, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'sessionId' })
    public session?: RecordingSession;
}
