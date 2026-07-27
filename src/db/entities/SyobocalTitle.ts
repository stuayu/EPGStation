import { BaseEntity, Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * しょぼいカレンダーから一括取得したアニメ作品情報 (TitleLookup の 1 作品分)
 * シリーズ自動マッピングの「正解タイトル辞書」として使う。tid は しょぼいカレンダーの TID をそのまま主キーにする
 */
@Entity({ name: 'syobocal_title' })
@Index('IDX_syobocal_title_lookup_key', ['lookupKey'])
export default class SyobocalTitle extends BaseEntity {
    @PrimaryColumn({ type: 'integer' }) tid!: number;
    @Column({ type: 'text' }) title!: string;
    // title を辞書照合用に正規化したキー (記号・空白を除去し小文字化したもの)
    @Column({ type: 'text' }) lookupKey!: string;
    @Column({ type: 'text', nullable: true }) shortTitle!: string | null;
    @Column({ type: 'text', nullable: true }) titleYomi!: string | null;
    @Column({ type: 'text', nullable: true }) titleEn!: string | null;
    // しょぼいカレンダーのカテゴリ番号 (作品種別)
    @Column({ type: 'integer', nullable: true }) cat!: number | null;
    @Column({ type: 'integer', nullable: true }) firstYear!: number | null;
    @Column({ type: 'integer', nullable: true }) firstMonth!: number | null;
    // SubTitles から得た放送予定総話数 (欠番検出の上限に使う)。取得できない場合は null
    @Column({ type: 'integer', nullable: true }) totalEpisodes!: number | null;
    // しょぼいカレンダー側の最終更新日時 (差分取得のカーソルに使う)
    @Column({ type: 'text', nullable: true }) lastUpdate!: string | null;
    @Column({ type: 'bigint' }) updatedAt!: number;
}
