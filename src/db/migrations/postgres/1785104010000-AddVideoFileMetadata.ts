import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddVideoFileMetadata1785104010000 implements MigrationInterface {
    name = 'AddVideoFileMetadata1785104010000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE "video_file" ADD "duration" double precision');
        await q.query('ALTER TABLE "video_file" ADD "startTime" double precision');
        await q.query('ALTER TABLE "video_file" ADD "startAt" bigint');
        await q.query('ALTER TABLE "video_file" ADD "videoCodec" text');
        await q.query('ALTER TABLE "video_file" ADD "audioCodec" text');
        await q.query('ALTER TABLE "video_file" ADD "width" integer');
        await q.query('ALTER TABLE "video_file" ADD "height" integer');
        await q.query('ALTER TABLE "video_file" ADD "bitRate" double precision');
        await q.query('ALTER TABLE "video_file" ADD "analyzedAt" bigint');
        await q.query('CREATE INDEX "IDX_video_file_analyzed_at" ON "video_file" ("analyzedAt")');
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP INDEX "IDX_video_file_analyzed_at"');
        await q.query('ALTER TABLE "video_file" DROP COLUMN "analyzedAt"');
        await q.query('ALTER TABLE "video_file" DROP COLUMN "bitRate"');
        await q.query('ALTER TABLE "video_file" DROP COLUMN "height"');
        await q.query('ALTER TABLE "video_file" DROP COLUMN "width"');
        await q.query('ALTER TABLE "video_file" DROP COLUMN "audioCodec"');
        await q.query('ALTER TABLE "video_file" DROP COLUMN "videoCodec"');
        await q.query('ALTER TABLE "video_file" DROP COLUMN "startAt"');
        await q.query('ALTER TABLE "video_file" DROP COLUMN "startTime"');
        await q.query('ALTER TABLE "video_file" DROP COLUMN "duration"');
    }
}
