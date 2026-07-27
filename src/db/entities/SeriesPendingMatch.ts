import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
/**
 * しきい値未満で自動確定できなかった録画を保持する未確定キュー (§4.5)
 * candidatesJson には上位候補 (seriesId + score) を JSON 文字列で保存する
 */
@Entity({ name: 'series_pending_match' })
@Index('IDX_series_pending_match_recorded', ['recordedId'], { unique: true })
export default class SeriesPendingMatch extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) id!: number;
    @Column({ type: 'integer' }) recordedId!: number;
    @Column({ type: 'text' }) normalizedTitle!: string;
    // channelId は networkId * 100000 + serviceId で生成され int の上限 (2147483647) を超えるため bigint にする
    @Column({ type: 'bigint' }) channelId!: number;
    // [{ seriesId: number, seriesTitle: string, score: number }] の JSON
    @Column({ type: 'text' }) candidatesJson!: string;
    @Column({ type: 'bigint' }) createdAt!: number;
}
