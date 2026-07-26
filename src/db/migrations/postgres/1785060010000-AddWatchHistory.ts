/* eslint-disable max-len */
import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddWatchHistory1785060010000 implements MigrationInterface {
    name = 'AddWatchHistory1785060010000';
    async up(q: QueryRunner): Promise<void> {
        await q.query(
            `CREATE TABLE "watch_history" ("id" SERIAL NOT NULL, "videoFileId" integer NOT NULL, "recordedId" integer NOT NULL, "userId" integer, "position" integer NOT NULL DEFAULT 0, "duration" integer NOT NULL DEFAULT 0, "status" text NOT NULL DEFAULT 'unwatched', "updatedAt" bigint NOT NULL, CONSTRAINT "PK_watch_history" PRIMARY KEY ("id"))`,
        );
        await q.query(`CREATE UNIQUE INDEX "IDX_watch_history_video_file_id" ON "watch_history" ("videoFileId")`);
        await q.query(`CREATE INDEX "IDX_watch_history_recorded_id" ON "watch_history" ("recordedId")`);
    }
    async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP TABLE "watch_history"`);
    }
}
