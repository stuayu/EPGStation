import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSeriesWikidataQid1785101020000 implements MigrationInterface {
    name = 'AddSeriesWikidataQid1785101020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `series` ADD `wikidataQid` varchar(32) NULL');
        await q.query('CREATE INDEX `IDX_series_wikidata_qid` ON `series` (`wikidataQid`)');
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP INDEX `IDX_series_wikidata_qid` ON `series`');
        await q.query('ALTER TABLE `series` DROP COLUMN `wikidataQid`');
    }
}
