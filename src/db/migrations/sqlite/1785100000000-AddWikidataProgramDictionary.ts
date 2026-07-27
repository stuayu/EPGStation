import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddWikidataProgramDictionary1785100000000 implements MigrationInterface {
    name = 'AddWikidataProgramDictionary1785100000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            `CREATE TABLE "wikidata_program" ("qid" text PRIMARY KEY NOT NULL,"title" text NOT NULL,` +
                `"strictKey" text NOT NULL,"syobocalTid" integer,"tmdbId" integer,"updatedAt" bigint NOT NULL)`,
        );
        await q.query(`CREATE INDEX "IDX_wikidata_program_strict_key" ON "wikidata_program" ("strictKey")`);
        await q.query(`CREATE INDEX "IDX_wikidata_program_syobocal_tid" ON "wikidata_program" ("syobocalTid")`);
        await q.query(
            `CREATE TABLE "wikidata_program_alias" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,` +
                `"strictKey" text NOT NULL,"qid" text NOT NULL,"rank" integer NOT NULL DEFAULT (2))`,
        );
        await q.query(`CREATE INDEX "IDX_wikidata_program_alias_key" ON "wikidata_program_alias" ("strictKey")`);
        await q.query(`CREATE INDEX "IDX_wikidata_program_alias_program" ON "wikidata_program_alias" ("qid")`);
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP INDEX "IDX_wikidata_program_alias_program"`);
        await q.query(`DROP INDEX "IDX_wikidata_program_alias_key"`);
        await q.query(`DROP TABLE "wikidata_program_alias"`);
        await q.query(`DROP INDEX "IDX_wikidata_program_syobocal_tid"`);
        await q.query(`DROP INDEX "IDX_wikidata_program_strict_key"`);
        await q.query(`DROP TABLE "wikidata_program"`);
    }
}
