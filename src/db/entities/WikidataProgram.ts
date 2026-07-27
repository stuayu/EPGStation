import { BaseEntity, Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Wikidata から一括取得した日本のテレビ番組情報。
 *
 * しょぼいカレンダー / Annict がアニメ専門なのに対し、こちらはドラマ・バラエティ・
 * 情報番組・ニュースなど**全ジャンル**を収録する (ローカル局の番組も含まれる)。
 * syobocalTid (P11648) を持つ項目はしょぼいカレンダー側の作品と厳密に同一視できる。
 *
 * 一般番組は「パラダイス」「わっち!!」のような短く一般的なタイトルが多く、
 * アニメ辞書と同じ含有一致を許すと誤爆するため、照合には strictKey の完全一致のみを使う
 * (装飾を取り除くのは LLM 抽出の役目)。
 */
@Entity({ name: 'wikidata_program' })
@Index('IDX_wikidata_program_strict_key', ['strictKey'])
@Index('IDX_wikidata_program_syobocal_tid', ['syobocalTid'])
export default class WikidataProgram extends BaseEntity {
    // Wikidata の項目 ID (例: Q11269387)
    @PrimaryColumn({ type: 'text' }) qid!: string;
    @Column({ type: 'text' }) title!: string;
    // title を厳密照合用に正規化したキー (長音符・波ダッシュを保持し、別番組の取り違えを防ぐ)
    @Column({ type: 'text' }) strictKey!: string;
    // しょぼいカレンダーのシリーズ ID (P11648)。既存のアニメ辞書と結合するためのキー
    @Column({ type: 'integer', nullable: true }) syobocalTid!: number | null;
    // TMDb テレビシリーズ ID (P4983)
    @Column({ type: 'integer', nullable: true }) tmdbId!: number | null;
    @Column({ type: 'bigint' }) updatedAt!: number;
}
