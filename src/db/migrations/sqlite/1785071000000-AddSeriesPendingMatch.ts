/* eslint-disable max-len */
import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSeriesPendingMatch1785071000000 implements MigrationInterface {
    name = 'AddSeriesPendingMatch1785071000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            `CREATE TABLE "series_pending_match" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,"recordedId" integer NOT NULL,"normalizedTitle" text NOT NULL,"channelId" integer NOT NULL,"candidatesJson" text NOT NULL,"createdAt" bigint NOT NULL)`,
        );
        await q.query(
            `CREATE UNIQUE INDEX "IDX_series_pending_match_recorded" ON "series_pending_match" ("recordedId")`,
        );
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP TABLE "series_pending_match"`);
    }
}
