import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
@Entity({ name: 'program_series_link' })
@Index('IDX_program_series_link_program', ['programId'], { unique: true })
@Index('IDX_program_series_link_series', ['seriesId'])
export default class ProgramSeriesLink extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) public id!: number;
    @Column({ type: 'bigint' }) public programId!: number;
    @Column({ type: 'integer' }) public seriesId!: number;
    @Column({ type: 'integer', nullable: true }) public episodeId!: number | null;
    @Column({ type: 'real', default: 0 }) public confidence = 0;
    @Column({ type: 'text', default: 'epg' }) public source = 'epg';
    @Column({ type: 'boolean', default: false }) public manualLock: boolean = false;
    @Column({ type: 'bigint' }) public updatedAt!: number;
}
