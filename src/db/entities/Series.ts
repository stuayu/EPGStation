import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
@Entity({ name: 'series' })
@Index('IDX_series_normalized_title', ['normalizedTitle'])
export default class Series extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) id!: number;
    @Column({ type: 'text' }) title!: string;
    @Column({ type: 'text' }) normalizedTitle!: string;
    @Column({ type: 'text', default: 'tv' }) mediaType: string = 'tv';
    @Column({ type: 'integer', nullable: true }) preferredChannelId!: number | null;
    @Column({ type: 'integer', nullable: true }) syobocalTid!: number | null;
    @Column({ type: 'text', nullable: true }) annictId!: string | null;
    @Column({ type: 'integer', nullable: true }) tmdbId!: number | null;
    @Column({ type: 'bigint' }) createdAt!: number;
    @Column({ type: 'bigint' }) updatedAt!: number;
}
