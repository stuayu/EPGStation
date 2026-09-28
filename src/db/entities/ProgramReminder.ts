import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 番組開始前に利用者へ通知するリマインダー
 */
@Entity({ name: 'program_reminder' })
@Index('IDX_program_reminder_programId', ['programId'])
export default class ProgramReminder extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' })
    public id!: number;

    @Column({ type: 'bigint' })
    public programId!: number;

    @Column({ type: 'bigint' })
    public channelId!: number;

    @Column({ type: 'text' })
    public name!: string;

    @Column({ type: 'bigint' })
    public startAt!: number;

    @Column({ type: 'integer', default: 5 })
    public minutesBefore: number = 5;

    @Column({ type: 'integer', nullable: true })
    public userId: number | null = null;

    @Column({ type: 'bigint' })
    public createdAt!: number;
}
