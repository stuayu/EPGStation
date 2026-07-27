import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddAnnictWorkDictionary1785094000000 implements MigrationInterface {
    name = 'AddAnnictWorkDictionary1785094000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            `CREATE TABLE "annict_work" (` +
                `"annictId" integer PRIMARY KEY NOT NULL,` +
                `"title" text NOT NULL,` +
                `"lookupKey" text NOT NULL,` +
                `"titleEn" text,` +
                `"titleKana" text,` +
                `"titleRo" text,` +
                `"syobocalTid" integer,` +
                `"seasonYear" integer,` +
                `"seasonName" text,` +
                `"episodesCount" integer,` +
                `"media" text,` +
                `"updatedAt" bigint NOT NULL)`,
        );
        await q.query(`CREATE INDEX "IDX_annict_work_lookup_key" ON "annict_work" ("lookupKey")`);
        await q.query(`CREATE INDEX "IDX_annict_work_syobocal_tid" ON "annict_work" ("syobocalTid")`);
        await q.query(
            `CREATE TABLE "annict_work_alias" (` +
                `"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,` +
                `"lookupKey" text NOT NULL,` +
                `"annictId" integer NOT NULL,` +
                `"rank" integer NOT NULL DEFAULT (2))`,
        );
        await q.query(`CREATE INDEX "IDX_annict_work_alias_key" ON "annict_work_alias" ("lookupKey")`);
        await q.query(`CREATE INDEX "IDX_annict_work_alias_work" ON "annict_work_alias" ("annictId")`);
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP TABLE "annict_work_alias"`);
        await q.query(`DROP TABLE "annict_work"`);
    }
}
