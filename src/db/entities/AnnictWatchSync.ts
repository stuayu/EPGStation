import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
export type AnnictWatchSyncStatus = 'pending' | 'sent' | 'failed';
/**
 * Annict 視聴記録の双方向同期キュー (§5.5)。WatchHistory が watched に遷移した際に積まれ、
 * 指数バックオフでリトライされる。(seriesId, seriesEpisodeId) の一意制約により
 * 同一エピソードの二重送信 (createRecord の重複実行) を防ぐ
 */
@Entity({ name: 'annict_watch_sync' })
@Index('IDX_annict_watch_sync_episode', ['seriesId', 'seriesEpisodeId'], { unique: true })
@Index('IDX_annict_watch_sync_status', ['status', 'nextAttemptAt'])
export default class AnnictWatchSync extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) id!: number;
    @Column({ type: 'integer' }) recordedId!: number;
    @Column({ type: 'integer' }) seriesId!: number;
    @Column({ type: 'integer' }) seriesEpisodeId!: number;
    @Column({ type: 'text' }) annictWorkId!: string;
    @Column({ type: 'real' }) episodeNumber!: number;
    @Column({ type: 'text', default: 'pending' }) status: AnnictWatchSyncStatus = 'pending';
    @Column({ type: 'integer', default: 0 }) attempts = 0;
    @Column({ type: 'bigint' }) nextAttemptAt!: number;
    @Column({ type: 'text', nullable: true }) lastError!: string | null;
    @Column({ type: 'bigint' }) createdAt!: number;
    @Column({ type: 'bigint' }) updatedAt!: number;
}
