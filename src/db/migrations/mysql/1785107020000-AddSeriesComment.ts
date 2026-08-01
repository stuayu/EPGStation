import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSeriesComment1785107020000 implements MigrationInterface {
    name = 'AddSeriesComment1785107020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `series` ADD `comment` text NULL');
        await q.query('ALTER TABLE `series` ADD `commentSource` varchar(16) NULL');
        await q.query('ALTER TABLE `series_episode` ADD `comment` text NULL');
        await q.query('ALTER TABLE `series_episode` ADD `commentSource` varchar(16) NULL');
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `series_episode` DROP COLUMN `commentSource`');
        await q.query('ALTER TABLE `series_episode` DROP COLUMN `comment`');
        await q.query('ALTER TABLE `series` DROP COLUMN `commentSource`');
        await q.query('ALTER TABLE `series` DROP COLUMN `comment`');
    }
}
