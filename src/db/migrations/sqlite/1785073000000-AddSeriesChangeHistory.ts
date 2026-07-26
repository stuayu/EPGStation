/* eslint-disable max-len */
import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSeriesChangeHistory1785073000000 implements MigrationInterface {
    name = 'AddSeriesChangeHistory1785073000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            `CREATE TABLE "series_change_history" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,"recordedId" integer NOT NULL,"action" text NOT NULL,"previousSeriesId" integer,"previousEpisodeId" integer,"previousAirType" text,"previousMatchMethod" text,"previousConfidence" real,"previousManualLock" boolean,"undone" boolean NOT NULL DEFAULT (0),"createdAt" bigint NOT NULL)`,
        );
        await q.query(`CREATE INDEX "IDX_series_change_history_recorded" ON "series_change_history" ("recordedId")`);
        await q.query(`CREATE INDEX "IDX_series_change_history_created" ON "series_change_history" ("createdAt")`);
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP TABLE "series_change_history"`);
    }
}
