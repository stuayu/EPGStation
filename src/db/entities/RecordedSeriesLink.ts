import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
export type SeriesAirType = 'first' | 'rerun' | 'delayed' | 'unknown';
export type SeriesMatchMethod = 'syobocal' | 'annict' | 'title' | 'manual';
@Entity({ name: 'recorded_series_link' })
@Index('IDX_recorded_series_link_recorded', ['recordedId'], { unique: true })
@Index('IDX_recorded_series_link_series', ['seriesId'])
export default class RecordedSeriesLink extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) id!: number;
    @Column({ type: 'integer' }) recordedId!: number;
    @Column({ type: 'integer' }) seriesId!: number;
    @Column({ type: 'integer', nullable: true }) episodeId!: number | null;
    @Column({ type: 'text', default: 'unknown' }) airType: SeriesAirType = 'unknown';
    @Column({ type: 'text', default: 'title' }) matchMethod: SeriesMatchMethod = 'title';
    @Column({ type: 'real', default: 0 }) confidence: number = 0;
    @Column({ default: false }) manualLock: boolean = false;
    @Column({ type: 'bigint' }) createdAt!: number;
    @Column({ type: 'bigint' }) updatedAt!: number;
}
