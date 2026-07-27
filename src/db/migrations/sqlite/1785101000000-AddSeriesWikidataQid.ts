import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSeriesWikidataQid1785101000000 implements MigrationInterface {
    name = 'AddSeriesWikidataQid1785101000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "series" ADD COLUMN "wikidataQid" text`);
        await q.query(`CREATE INDEX "IDX_series_wikidata_qid" ON "series" ("wikidataQid")`);
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP INDEX "IDX_series_wikidata_qid"`);
        await q.query(`ALTER TABLE "series" DROP COLUMN "wikidataQid"`);
    }
}
