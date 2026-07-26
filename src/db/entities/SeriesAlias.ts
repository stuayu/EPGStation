import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
/**
 * 手動修正時に学習する「正規化タイトル → シリーズ」のエイリアス辞書 (§4.8)
 * SeriesResolver はスコアリングより先にこの辞書を参照し、一致すれば確度 1.0 の 'alias' 判定で確定させる
 */
@Entity({ name: 'series_alias' })
@Index('IDX_series_alias_normalized_title', ['normalizedTitle'], { unique: true })
@Index('IDX_series_alias_series', ['seriesId'])
export default class SeriesAlias extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) id!: number;
    @Column({ type: 'text' }) normalizedTitle!: string;
    @Column({ type: 'integer' }) seriesId!: number;
    @Column({ type: 'bigint' }) createdAt!: number;
}
