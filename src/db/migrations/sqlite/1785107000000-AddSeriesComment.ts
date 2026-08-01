import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSeriesComment1785107000000 implements MigrationInterface {
    name = 'AddSeriesComment1785107000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "series" ADD COLUMN "comment" text`);
        await q.query(`ALTER TABLE "series" ADD COLUMN "commentSource" text`);
        await q.query(`ALTER TABLE "series_episode" ADD COLUMN "comment" text`);
        await q.query(`ALTER TABLE "series_episode" ADD COLUMN "commentSource" text`);
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "series_episode" DROP COLUMN "commentSource"`);
        await q.query(`ALTER TABLE "series_episode" DROP COLUMN "comment"`);
        await q.query(`ALTER TABLE "series" DROP COLUMN "commentSource"`);
        await q.query(`ALTER TABLE "series" DROP COLUMN "comment"`);
    }
}
