import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddVideoFileMetadata1785104000000 implements MigrationInterface {
    name = 'AddVideoFileMetadata1785104000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "video_file" ADD COLUMN "duration" float`);
        await q.query(`ALTER TABLE "video_file" ADD COLUMN "startTime" float`);
        await q.query(`ALTER TABLE "video_file" ADD COLUMN "startAt" bigint`);
        await q.query(`ALTER TABLE "video_file" ADD COLUMN "videoCodec" text`);
        await q.query(`ALTER TABLE "video_file" ADD COLUMN "audioCodec" text`);
        await q.query(`ALTER TABLE "video_file" ADD COLUMN "width" integer`);
        await q.query(`ALTER TABLE "video_file" ADD COLUMN "height" integer`);
        await q.query(`ALTER TABLE "video_file" ADD COLUMN "bitRate" float`);
        await q.query(`ALTER TABLE "video_file" ADD COLUMN "analyzedAt" bigint`);
        await q.query(`CREATE INDEX "IDX_video_file_analyzed_at" ON "video_file" ("analyzedAt")`);
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP INDEX "IDX_video_file_analyzed_at"`);
        await q.query(`ALTER TABLE "video_file" DROP COLUMN "analyzedAt"`);
        await q.query(`ALTER TABLE "video_file" DROP COLUMN "bitRate"`);
        await q.query(`ALTER TABLE "video_file" DROP COLUMN "height"`);
        await q.query(`ALTER TABLE "video_file" DROP COLUMN "width"`);
        await q.query(`ALTER TABLE "video_file" DROP COLUMN "audioCodec"`);
        await q.query(`ALTER TABLE "video_file" DROP COLUMN "videoCodec"`);
        await q.query(`ALTER TABLE "video_file" DROP COLUMN "startAt"`);
        await q.query(`ALTER TABLE "video_file" DROP COLUMN "startTime"`);
        await q.query(`ALTER TABLE "video_file" DROP COLUMN "duration"`);
    }
}
