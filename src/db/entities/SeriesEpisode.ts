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
    @Column({ type: 'bigint', nullable: true }) airedAt!: number | null;
    @Column({ type: 'bigint' }) createdAt!: number;
    @Column({ type: 'bigint' }) updatedAt!: number;
}
