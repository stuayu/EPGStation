import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
/**
 * 「正規化タイトル → シリーズ」のエイリアス辞書 (§4.8)
 * SeriesResolver はスコアリングより先にこの辞書を参照し、一致すれば確度 1.0 の 'alias' 判定で確定させる。
 * 手動修正のほか、LLM が抽出した作品名が作品辞書と完全一致した場合も自動学習する (source で区別する)
 */
@Entity({ name: 'series_alias' })
@Index('IDX_series_alias_normalized_title', ['normalizedTitle'], { unique: true })
@Index('IDX_series_alias_series', ['seriesId'])
export default class SeriesAlias extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) id!: number;
    @Column({ type: 'text' }) normalizedTitle!: string;
    @Column({ type: 'integer' }) seriesId!: number;
    // 学習元。'manual': 手動修正 / 'llm': LLM が抽出した作品名を作品辞書で検証して学習
    @Column({ type: 'text', default: 'manual' }) source: string = 'manual';
    @Column({ type: 'bigint' }) createdAt!: number;
}
