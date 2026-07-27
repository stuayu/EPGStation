import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSeriesSeasonAndKana1785096000000 implements MigrationInterface {
    name = 'AddSeriesSeasonAndKana1785096000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "series" ADD COLUMN "titleKana" text`);
        await q.query(`ALTER TABLE "series" ADD COLUMN "seasonYear" integer`);
        await q.query(`ALTER TABLE "series" ADD COLUMN "seasonName" text`);
        await q.query(`ALTER TABLE "series" ADD COLUMN "totalEpisodes" integer`);
        await q.query(`CREATE INDEX "IDX_series_season" ON "series" ("seasonYear", "seasonName")`);
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP INDEX "IDX_series_season"`);
        await q.query(`ALTER TABLE "series" DROP COLUMN "totalEpisodes"`);
        await q.query(`ALTER TABLE "series" DROP COLUMN "seasonName"`);
        await q.query(`ALTER TABLE "series" DROP COLUMN "seasonYear"`);
        await q.query(`ALTER TABLE "series" DROP COLUMN "titleKana"`);
    }
}
