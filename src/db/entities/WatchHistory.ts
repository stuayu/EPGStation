import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
export type WatchStatus = 'unwatched' | 'watching' | 'watched';
@Entity({ name: 'watch_history' })
@Index('IDX_watch_history_video_file_id', ['videoFileId'], { unique: true })
@Index('IDX_watch_history_recorded_id', ['recordedId'])
export default class WatchHistory extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) public id!: number;
    @Column({ type: 'integer' }) public videoFileId!: number;
    @Column({ type: 'integer' }) public recordedId!: number;
    @Column({ type: 'integer', nullable: true }) public userId!: number | null;
    @Column({ type: 'integer', default: 0 }) public position = 0;
    @Column({ type: 'integer', default: 0 }) public duration = 0;
    // MySQL は TEXT/BLOB 列に DEFAULT を持てないため varchar にしている
    // (既存 DB は 1785090020000-FixWatchHistoryStatusColumn マイグレーションで移行する)
    @Column({ type: 'varchar', length: 20, default: 'unwatched' }) public status: WatchStatus = 'unwatched';
    @Column({ type: 'bigint' }) public updatedAt!: number;
}
