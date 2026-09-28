import { BaseEntity, Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import RecordingAttempt from './RecordingAttempt';
import type { RecordingResultStatus } from '../../util/RecordingResult';

@Entity()
export default class RecordingSession extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' })
    public id!: number;

    @Column({ type: 'integer' })
    public reserveId!: number;

    @Column({ type: 'integer', nullable: true })
    public recordedId!: number | null;

    @Column({ type: 'bigint', nullable: true })
    public programId!: number | null;

    @Column({ type: 'bigint' })
    public channelId!: number;

    @Column({ type: 'text' })
    public state!: string;

    @Column({ type: 'bigint' })
    public scheduledStartAt!: number;

    @Column({ type: 'bigint' })
    public scheduledEndAt!: number;

    @Column({ type: 'bigint', nullable: true })
    public actualStartAt!: number | null;

    @Column({ type: 'bigint', nullable: true })
    public actualEndAt!: number | null;

    @Column({ type: 'text', nullable: true })
    public startReason!: string | null;

    @Column({ type: 'text', nullable: true })
    public endReason!: string | null;

    @Column({ type: 'text', nullable: true })
    public resultStatus!: RecordingResultStatus | null;

    @Column({ type: 'integer', default: 0 })
    public retryCount!: number;

    @Column({ type: 'bigint' })
    public createdAt!: number;

    @Column({ type: 'bigint' })
    public updatedAt!: number;

    @OneToMany(() => RecordingAttempt, attempt => attempt.session)
    public attempts?: RecordingAttempt[];
}
