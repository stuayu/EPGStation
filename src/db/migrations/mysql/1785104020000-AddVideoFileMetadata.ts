import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddVideoFileMetadata1785104020000 implements MigrationInterface {
    name = 'AddVideoFileMetadata1785104020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `video_file` ADD `duration` double NULL');
        await q.query('ALTER TABLE `video_file` ADD `startTime` double NULL');
        await q.query('ALTER TABLE `video_file` ADD `startAt` bigint NULL');
        await q.query('ALTER TABLE `video_file` ADD `videoCodec` text NULL');
        await q.query('ALTER TABLE `video_file` ADD `audioCodec` text NULL');
        await q.query('ALTER TABLE `video_file` ADD `width` int NULL');
        await q.query('ALTER TABLE `video_file` ADD `height` int NULL');
        await q.query('ALTER TABLE `video_file` ADD `bitRate` double NULL');
        await q.query('ALTER TABLE `video_file` ADD `analyzedAt` bigint NULL');
        await q.query('CREATE INDEX `IDX_video_file_analyzed_at` ON `video_file` (`analyzedAt`)');
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP INDEX `IDX_video_file_analyzed_at` ON `video_file`');
        await q.query('ALTER TABLE `video_file` DROP COLUMN `analyzedAt`');
        await q.query('ALTER TABLE `video_file` DROP COLUMN `bitRate`');
        await q.query('ALTER TABLE `video_file` DROP COLUMN `height`');
        await q.query('ALTER TABLE `video_file` DROP COLUMN `width`');
        await q.query('ALTER TABLE `video_file` DROP COLUMN `audioCodec`');
        await q.query('ALTER TABLE `video_file` DROP COLUMN `videoCodec`');
        await q.query('ALTER TABLE `video_file` DROP COLUMN `startAt`');
        await q.query('ALTER TABLE `video_file` DROP COLUMN `startTime`');
        await q.query('ALTER TABLE `video_file` DROP COLUMN `duration`');
    }
}
