import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddAnnictWatchSync1785080000000 implements MigrationInterface {
    name = 'AddAnnictWatchSync1785080000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            `CREATE TABLE "annict_watch_sync" (` +
                `"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,` +
                `"recordedId" integer NOT NULL,` +
                `"seriesId" integer NOT NULL,` +
                `"seriesEpisodeId" integer NOT NULL,` +
                `"annictWorkId" text NOT NULL,` +
                `"episodeNumber" real NOT NULL,` +
                `"status" text NOT NULL DEFAULT ('pending'),` +
                `"attempts" integer NOT NULL DEFAULT (0),` +
                `"nextAttemptAt" bigint NOT NULL,` +
                `"lastError" text,` +
                `"createdAt" bigint NOT NULL,` +
                `"updatedAt" bigint NOT NULL)`,
        );
        await q.query(
            `CREATE UNIQUE INDEX "IDX_annict_watch_sync_episode" ON "annict_watch_sync" ("seriesId", "seriesEpisodeId")`,
        );
        await q.query(`CREATE INDEX "IDX_annict_watch_sync_status" ON "annict_watch_sync" ("status", "nextAttemptAt")`);
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP TABLE "annict_watch_sync"`);
    }
}
