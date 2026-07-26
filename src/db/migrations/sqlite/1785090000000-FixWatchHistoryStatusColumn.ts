/* eslint-disable max-len */
import { MigrationInterface, QueryRunner } from 'typeorm';
/**
 * watch_history.status のカラム型を varchar(20) に揃え、エンティティ定義
 * (mysql 側の 1785090020000-FixWatchHistoryStatusColumn と対) と一致させる (§S1-3)。
 * SQLite は ALTER COLUMN TYPE をサポートしないため、テーブルを再作成してデータを移行する
 */
export class FixWatchHistoryStatusColumn1785090000000 implements MigrationInterface {
    name = 'FixWatchHistoryStatusColumn1785090000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(`DROP INDEX IF EXISTS "IDX_watch_history_video_file_id"`);
        await q.query(`DROP INDEX IF EXISTS "IDX_watch_history_recorded_id"`);
        await q.query(`ALTER TABLE "watch_history" RENAME TO "watch_history_old"`);
        await q.query(
            `CREATE TABLE "watch_history" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "videoFileId" integer NOT NULL, "recordedId" integer NOT NULL, "userId" integer, "position" integer NOT NULL DEFAULT (0), "duration" integer NOT NULL DEFAULT (0), "status" varchar(20) NOT NULL DEFAULT ('unwatched'), "updatedAt" bigint NOT NULL)`,
        );
        await q.query(
            `INSERT INTO "watch_history" ("id", "videoFileId", "recordedId", "userId", "position", "duration", "status", "updatedAt") SELECT "id", "videoFileId", "recordedId", "userId", "position", "duration", "status", "updatedAt" FROM "watch_history_old"`,
        );
        await q.query(`DROP TABLE "watch_history_old"`);
        await q.query(`CREATE UNIQUE INDEX "IDX_watch_history_video_file_id" ON "watch_history" ("videoFileId")`);
        await q.query(`CREATE INDEX "IDX_watch_history_recorded_id" ON "watch_history" ("recordedId")`);
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP INDEX IF EXISTS "IDX_watch_history_video_file_id"`);
        await q.query(`DROP INDEX IF EXISTS "IDX_watch_history_recorded_id"`);
        await q.query(`ALTER TABLE "watch_history" RENAME TO "watch_history_old"`);
        await q.query(
            `CREATE TABLE "watch_history" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "videoFileId" integer NOT NULL, "recordedId" integer NOT NULL, "userId" integer, "position" integer NOT NULL DEFAULT (0), "duration" integer NOT NULL DEFAULT (0), "status" text NOT NULL DEFAULT ('unwatched'), "updatedAt" bigint NOT NULL)`,
        );
        await q.query(
            `INSERT INTO "watch_history" ("id", "videoFileId", "recordedId", "userId", "position", "duration", "status", "updatedAt") SELECT "id", "videoFileId", "recordedId", "userId", "position", "duration", "status", "updatedAt" FROM "watch_history_old"`,
        );
        await q.query(`DROP TABLE "watch_history_old"`);
        await q.query(`CREATE UNIQUE INDEX "IDX_watch_history_video_file_id" ON "watch_history" ("videoFileId")`);
        await q.query(`CREATE INDEX "IDX_watch_history_recorded_id" ON "watch_history" ("recordedId")`);
    }
}
