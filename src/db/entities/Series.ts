import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
@Entity({ name: 'series' })
@Index('IDX_series_normalized_title', ['normalizedTitle'])
export default class Series extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) id!: number;
    @Column({ type: 'text' }) title!: string;
    @Column({ type: 'text' }) normalizedTitle!: string;
    @Column({ type: 'text', default: 'tv' }) mediaType: string = 'tv';
    // channelId は networkId * 100000 + serviceId で生成され int の上限 (2147483647) を超えるため bigint にする
    @Column({ type: 'bigint', nullable: true }) preferredChannelId!: number | null;
    @Column({ type: 'integer', nullable: true }) syobocalTid!: number | null;
    @Column({ type: 'text', nullable: true }) annictId!: string | null;
    @Column({ type: 'integer', nullable: true }) tmdbId!: number | null;
    // 読み仮名 (しょぼいカレンダーの TitleYomi / Annict の titleKana 由来)。あいうえお順の並べ替えに使う
    @Column({ type: 'text', nullable: true }) titleKana!: string | null;
    // 放送クール (Annict の seasonYear/seasonName、または しょぼいカレンダーの初回放送年月から導出)
    @Column({ type: 'integer', nullable: true }) seasonYear!: number | null;
    // 'WINTER' | 'SPRING' | 'SUMMER' | 'AUTUMN'
    @Column({ type: 'text', nullable: true }) seasonName!: string | null;
    // クールの出所。'dictionary': 作品辞書 / 'estimated': 最古の録画日時からの推測 / 'manual': 手動設定。
    // 'manual' は自動補完で上書きしない
    @Column({ type: 'text', nullable: true }) seasonSource!: string | null;
    // 放送予定総話数 (完結判定・欠番検出の上限に使う)
    @Column({ type: 'integer', nullable: true }) totalEpisodes!: number | null;
    @Column({ type: 'bigint' }) createdAt!: number;
    @Column({ type: 'bigint' }) updatedAt!: number;
}
