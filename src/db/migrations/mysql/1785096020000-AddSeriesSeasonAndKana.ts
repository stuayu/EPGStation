import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSeriesSeasonAndKana1785096020000 implements MigrationInterface {
    name = 'AddSeriesSeasonAndKana1785096020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `series` ADD `titleKana` text NULL');
        await q.query('ALTER TABLE `series` ADD `seasonYear` int NULL');
        await q.query('ALTER TABLE `series` ADD `seasonName` varchar(16) NULL');
        await q.query('ALTER TABLE `series` ADD `totalEpisodes` int NULL');
        await q.query('CREATE INDEX `IDX_series_season` ON `series` (`seasonYear`, `seasonName`)');
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP INDEX `IDX_series_season` ON `series`');
        await q.query('ALTER TABLE `series` DROP COLUMN `totalEpisodes`');
        await q.query('ALTER TABLE `series` DROP COLUMN `seasonName`');
        await q.query('ALTER TABLE `series` DROP COLUMN `seasonYear`');
        await q.query('ALTER TABLE `series` DROP COLUMN `titleKana`');
    }
}
