/* eslint-disable max-len */
import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSeriesCore1785062000000 implements MigrationInterface {
    name = 'AddSeriesCore1785062000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            `CREATE TABLE "series" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,"title" text NOT NULL,"normalizedTitle" text NOT NULL,"mediaType" text NOT NULL DEFAULT ('tv'),"preferredChannelId" integer,"syobocalTid" integer,"annictId" text,"tmdbId" integer,"createdAt" bigint NOT NULL,"updatedAt" bigint NOT NULL)`,
        );
        await q.query(`CREATE INDEX "IDX_series_normalized_title" ON "series" ("normalizedTitle")`);
        await q.query(
            `CREATE TABLE "series_episode" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,"seriesId" integer NOT NULL,"seasonNumber" integer NOT NULL DEFAULT (1),"episodeNumber" real,"episodeLabel" text,"title" text,"airedAt" bigint,"createdAt" bigint NOT NULL,"updatedAt" bigint NOT NULL)`,
        );
        await q.query(
            `CREATE UNIQUE INDEX "IDX_series_episode_identity" ON "series_episode" ("seriesId","seasonNumber","episodeNumber")`,
        );
        await q.query(
            `CREATE TABLE "recorded_series_link" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,"recordedId" integer NOT NULL,"seriesId" integer NOT NULL,"episodeId" integer,"airType" text NOT NULL DEFAULT ('unknown'),"matchMethod" text NOT NULL DEFAULT ('title'),"confidence" real NOT NULL DEFAULT (0),"manualLock" boolean NOT NULL DEFAULT (0),"createdAt" bigint NOT NULL,"updatedAt" bigint NOT NULL)`,
        );
        await q.query(
            `CREATE UNIQUE INDEX "IDX_recorded_series_link_recorded" ON "recorded_series_link" ("recordedId")`,
        );
        await q.query(`CREATE INDEX "IDX_recorded_series_link_series" ON "recorded_series_link" ("seriesId")`);
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP TABLE "recorded_series_link"`);
        await q.query(`DROP TABLE "series_episode"`);
        await q.query(`DROP TABLE "series"`);
    }
}
