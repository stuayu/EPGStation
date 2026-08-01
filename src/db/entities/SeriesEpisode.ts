import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
@Entity({ name: 'series_episode' })
@Index('IDX_series_episode_identity', ['seriesId', 'seasonNumber', 'episodeNumber'], { unique: true })
export default class SeriesEpisode extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) id!: number;
    @Column({ type: 'integer' }) seriesId!: number;
    @Column({ type: 'integer', default: 1 }) seasonNumber: number = 1;
    @Column({ type: 'real', nullable: true }) episodeNumber!: number | null;
    @Column({ type: 'text', nullable: true }) episodeLabel!: string | null;
    @Column({ type: 'text', nullable: true }) title!: string | null;
    // 放送回コメント (しょぼいカレンダーの ProgItem.ProgComment。「定刻放送」「30分繰り下げ」等の覚え書き)
    @Column({ type: 'text', nullable: true }) comment!: string | null;
    // コメントの出所。'dictionary': 放送予定から取得 / 'manual': 画面から編集。
    // 'manual' は自動同期で上書きしない
    @Column({ type: 'text', nullable: true }) commentSource!: string | null;
    @Column({ type: 'bigint', nullable: true }) airedAt!: number | null;
    @Column({ type: 'bigint' }) createdAt!: number;
    @Column({ type: 'bigint' }) updatedAt!: number;
}
