import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddRecordedSeriesLinkChannelId1785070000000 implements MigrationInterface {
    name = 'AddRecordedSeriesLinkChannelId1785070000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "recorded_series_link" ADD COLUMN "channelId" integer NOT NULL DEFAULT (0)`);
        await q.query(
            `UPDATE "recorded_series_link"
             SET "channelId" = (
                 SELECT "channelId" FROM "recorded" WHERE "recorded"."id" = "recorded_series_link"."recordedId"
             )
             WHERE EXISTS (SELECT 1 FROM "recorded" WHERE "recorded"."id" = "recorded_series_link"."recordedId")`,
        );
        await q.query(
            `CREATE INDEX "IDX_recorded_series_link_series_channel" ON "recorded_series_link" ("seriesId","channelId")`,
        );
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP INDEX "IDX_recorded_series_link_series_channel"`);
        await q.query(`ALTER TABLE "recorded_series_link" DROP COLUMN "channelId"`);
    }
}
