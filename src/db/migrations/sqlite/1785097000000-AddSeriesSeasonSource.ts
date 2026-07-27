import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSeriesSeasonSource1785097000000 implements MigrationInterface {
    name = 'AddSeriesSeasonSource1785097000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "series" ADD COLUMN "seasonSource" text`);
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "series" DROP COLUMN "seasonSource"`);
    }
}
