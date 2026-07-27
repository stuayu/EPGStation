import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSeriesAlias1785072000000 implements MigrationInterface {
    name = 'AddSeriesAlias1785072000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            `CREATE TABLE "series_alias" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,"normalizedTitle" text NOT NULL,"seriesId" integer NOT NULL,"createdAt" bigint NOT NULL)`,
        );
        await q.query(`CREATE UNIQUE INDEX "IDX_series_alias_normalized_title" ON "series_alias" ("normalizedTitle")`);
        await q.query(`CREATE INDEX "IDX_series_alias_series" ON "series_alias" ("seriesId")`);
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP TABLE "series_alias"`);
    }
}
