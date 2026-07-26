import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SeriesAirType } from './RecordedSeriesLink';
/**
 * 欠番補完予約提案 (§4.7) から作成された予約に、録画完了時点で使う airType のヒントを
 * 事前付与しておくためのテーブル。SeriesResolver.resolve() は録画完了時にこのヒントを参照し、
 * 見つかれば通常のスコアリング判定より優先して episode/airType を確定させ、使用後は削除する
 */
@Entity({ name: 'series_reservation_hint' })
@Index('IDX_series_reservation_hint_reserve', ['reserveId'], { unique: true })
export default class SeriesReservationHint extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) id!: number;
    @Column({ type: 'integer' }) reserveId!: number;
    @Column({ type: 'integer' }) seriesId!: number;
    @Column({ type: 'integer' }) episodeId!: number;
    @Column({ type: 'text' }) airType!: SeriesAirType;
    @Column({ type: 'bigint' }) createdAt!: number;
}
