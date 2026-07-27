import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSeriesSeasonSource1785097020000 implements MigrationInterface {
    name = 'AddSeriesSeasonSource1785097020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `series` ADD `seasonSource` varchar(16) NULL');
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `series` DROP COLUMN `seasonSource`');
    }
}
