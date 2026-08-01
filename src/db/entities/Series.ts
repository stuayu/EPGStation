import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
@Entity({ name: 'series' })
@Index('IDX_series_normalized_title', ['normalizedTitle'])
@Index('IDX_series_wikidata_qid', ['wikidataQid'])
export default class Series extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) id!: number;
    @Column({ type: 'text' }) title!: string;
    // 表示名の出所。'dictionary': 作品辞書の正式タイトルへ同期済み / 'manual': 画面から編集。
    // 'manual' は辞書の再取得で上書きしない (null は録画タイトル由来のまま = 同期対象)
    @Column({ type: 'text', nullable: true }) titleSource!: string | null;
    // 引き当てキー。表示名を辞書名へ差し替えても、録画タイトル由来のこの値は変えない
    @Column({ type: 'text' }) normalizedTitle!: string;
    @Column({ type: 'text', default: 'tv' }) mediaType: string = 'tv';
    // channelId は networkId * 100000 + serviceId で生成され int の上限 (2147483647) を超えるため bigint にする
    @Column({ type: 'bigint', nullable: true }) preferredChannelId!: number | null;
    @Column({ type: 'integer', nullable: true }) syobocalTid!: number | null;
    @Column({ type: 'text', nullable: true }) annictId!: string | null;
    // Wikidata 項目 ID (全ジャンル番組辞書。ドラマ・バラエティ等はこれが主キーになる)
    @Column({ type: 'text', nullable: true }) wikidataQid!: string | null;
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
    // 作品コメント (しょぼいカレンダーの TitleItem.Comment。公式リンク・スタッフ・主題歌などの覚え書き)
    @Column({ type: 'text', nullable: true }) comment!: string | null;
    // コメントの出所。'dictionary': 作品辞書から取得 / 'manual': 画面から編集。
    // 'manual' は自動同期で上書きしない
    @Column({ type: 'text', nullable: true }) commentSource!: string | null;
    @Column({ type: 'bigint' }) createdAt!: number;
    @Column({ type: 'bigint' }) updatedAt!: number;
}
