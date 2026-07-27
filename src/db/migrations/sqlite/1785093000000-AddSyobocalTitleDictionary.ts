import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSyobocalTitleDictionary1785093000000 implements MigrationInterface {
    name = 'AddSyobocalTitleDictionary1785093000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            `CREATE TABLE "syobocal_title" (` +
                `"tid" integer PRIMARY KEY NOT NULL,` +
                `"title" text NOT NULL,` +
                `"lookupKey" text NOT NULL,` +
                `"shortTitle" text,` +
                `"titleYomi" text,` +
                `"titleEn" text,` +
                `"cat" integer,` +
                `"firstYear" integer,` +
                `"firstMonth" integer,` +
                `"totalEpisodes" integer,` +
                `"lastUpdate" text,` +
                `"updatedAt" bigint NOT NULL)`,
        );
        await q.query(`CREATE INDEX "IDX_syobocal_title_lookup_key" ON "syobocal_title" ("lookupKey")`);
        await q.query(
            `CREATE TABLE "syobocal_title_alias" (` +
                `"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,` +
                `"lookupKey" text NOT NULL,` +
                `"tid" integer NOT NULL,` +
                `"rank" integer NOT NULL DEFAULT (2))`,
        );
        await q.query(`CREATE INDEX "IDX_syobocal_title_alias_key" ON "syobocal_title_alias" ("lookupKey")`);
        await q.query(`CREATE INDEX "IDX_syobocal_title_alias_tid" ON "syobocal_title_alias" ("tid")`);
        await q.query(
            `CREATE TABLE "syobocal_title_episode" (` +
                `"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,` +
                `"tid" integer NOT NULL,` +
                `"episodeNumber" integer NOT NULL,` +
                `"subTitle" text NOT NULL,` +
                `"lookupKey" text NOT NULL)`,
        );
        await q.query(`CREATE INDEX "IDX_syobocal_title_episode_tid" ON "syobocal_title_episode" ("tid")`);
        await q.query(`CREATE INDEX "IDX_syobocal_title_episode_key" ON "syobocal_title_episode" ("lookupKey")`);
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP TABLE "syobocal_title_episode"`);
        await q.query(`DROP TABLE "syobocal_title_alias"`);
        await q.query(`DROP TABLE "syobocal_title"`);
    }
}
