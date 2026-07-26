import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSeriesReservationHint1785081000000 implements MigrationInterface {
    name = 'AddSeriesReservationHint1785081000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            `CREATE TABLE "series_reservation_hint" (` +
                `"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,` +
                `"reserveId" integer NOT NULL,` +
                `"seriesId" integer NOT NULL,` +
                `"episodeId" integer NOT NULL,` +
                `"airType" text NOT NULL,` +
                `"createdAt" bigint NOT NULL)`,
        );
        await q.query(
            `CREATE UNIQUE INDEX "IDX_series_reservation_hint_reserve" ON "series_reservation_hint" ("reserveId")`,
        );
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP TABLE "series_reservation_hint"`);
    }
}
