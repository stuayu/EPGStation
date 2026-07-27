import { BaseEntity, Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Annict から一括取得した作品情報 (searchWorks の 1 作品分)
 * しょぼいカレンダー辞書と合わせてシリーズ照合の「正解辞書」として使う。
 * syobocalTid を持つ作品はしょぼいカレンダー側の作品と厳密に同一視できる (Annict 側が保持する対応表)
 */
@Entity({ name: 'annict_work' })
@Index('IDX_annict_work_lookup_key', ['lookupKey'])
@Index('IDX_annict_work_syobocal_tid', ['syobocalTid'])
export default class AnnictWork extends BaseEntity {
    @PrimaryColumn({ type: 'integer' }) annictId!: number;
    @Column({ type: 'text' }) title!: string;
    // title を辞書照合用に正規化したキー
    @Column({ type: 'text' }) lookupKey!: string;
    @Column({ type: 'text', nullable: true }) titleEn!: string | null;
    @Column({ type: 'text', nullable: true }) titleKana!: string | null;
    @Column({ type: 'text', nullable: true }) titleRo!: string | null;
    // しょぼいカレンダー TID との対応 (Annict 側が保持)。null の作品はしょぼいカレンダー未登録
    @Column({ type: 'integer', nullable: true }) syobocalTid!: number | null;
    @Column({ type: 'integer', nullable: true }) seasonYear!: number | null;
    @Column({ type: 'text', nullable: true }) seasonName!: string | null;
    // 放送予定総話数 (欠番検出の上限に使う)
    @Column({ type: 'integer', nullable: true }) episodesCount!: number | null;
    // TV / OVA / MOVIE / WEB / OTHER
    @Column({ type: 'text', nullable: true }) media!: string | null;
    // アイキャッチ画像の URL。Annict は自前で画像を保持せず作品公式サイトの OGP 画像等を指すため、
    // 直リンクせずサーバ側で取得・キャッシュして配信する (SeriesImageModel 参照)
    @Column({ type: 'text', nullable: true }) imageUrl!: string | null;
    // 画像の著作権表記 (表示時のクレジットに使う)
    @Column({ type: 'text', nullable: true }) imageCopyright!: string | null;
    @Column({ type: 'bigint' }) updatedAt!: number;
}
