import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSeriesAliasSource1785099020000 implements MigrationInterface {
    name = 'AddSeriesAliasSource1785099020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query("ALTER TABLE `series_alias` ADD `source` varchar(16) NOT NULL DEFAULT 'manual'");
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `series_alias` DROP COLUMN `source`');
    }
}
