import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
export type SeriesChangeAction = 'assign' | 'unassign' | 'merge' | 'split';
/**
 * 手動操作 (割当 / 解除 / マージ / 分割) の変更前スナップショットを保持し Undo を可能にする (§4.8 可逆性)
 * previous* は変更前の recorded_series_link の状態 (存在しなかった場合は null)
 */
@Entity({ name: 'series_change_history' })
@Index('IDX_series_change_history_recorded', ['recordedId'])
@Index('IDX_series_change_history_created', ['createdAt'])
export default class SeriesChangeHistory extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) id!: number;
    @Column({ type: 'integer' }) recordedId!: number;
    @Column({ type: 'text' }) action!: SeriesChangeAction;
    @Column({ type: 'integer', nullable: true }) previousSeriesId!: number | null;
    @Column({ type: 'integer', nullable: true }) previousEpisodeId!: number | null;
    @Column({ type: 'text', nullable: true }) previousAirType!: string | null;
    @Column({ type: 'text', nullable: true }) previousMatchMethod!: string | null;
    @Column({ type: 'real', nullable: true }) previousConfidence!: number | null;
    @Column({ type: 'boolean', nullable: true }) previousManualLock!: boolean | null;
    @Column({ default: false }) undone: boolean = false;
    @Column({ type: 'bigint' }) createdAt!: number;
}
