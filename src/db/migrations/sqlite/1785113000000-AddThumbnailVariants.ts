import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddThumbnailVariants1785113000000 implements MigrationInterface {
    name = 'AddThumbnailVariants1785113000000';

    public async up(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "thumbnail" ADD COLUMN "variant" varchar NOT NULL DEFAULT ('poster')`);
        await q.query(`ALTER TABLE "thumbnail" ADD COLUMN "width" integer`);
        await q.query(`ALTER TABLE "thumbnail" ADD COLUMN "height" integer`);
        await q.query(`ALTER TABLE "thumbnail" ADD COLUMN "timestamp" float`);
        await q.query(`ALTER TABLE "thumbnail" ADD COLUMN "score" float`);
        await q.query(`ALTER TABLE "thumbnail" ADD COLUMN "format" varchar NOT NULL DEFAULT ('jpeg')`);
        await q.query(`ALTER TABLE "thumbnail" ADD COLUMN "createdAt" datetime`);
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "thumbnail" DROP COLUMN "createdAt"`);
        await q.query(`ALTER TABLE "thumbnail" DROP COLUMN "format"`);
        await q.query(`ALTER TABLE "thumbnail" DROP COLUMN "score"`);
        await q.query(`ALTER TABLE "thumbnail" DROP COLUMN "timestamp"`);
        await q.query(`ALTER TABLE "thumbnail" DROP COLUMN "height"`);
        await q.query(`ALTER TABLE "thumbnail" DROP COLUMN "width"`);
        await q.query(`ALTER TABLE "thumbnail" DROP COLUMN "variant"`);
    }
}
