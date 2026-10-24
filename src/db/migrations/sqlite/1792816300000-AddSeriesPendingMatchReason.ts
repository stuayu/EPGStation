import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSeriesPendingMatchReason1792816300000 implements MigrationInterface {
    name = 'AddSeriesPendingMatchReason1792816300000';

    public async up(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE "series_pending_match" ADD COLUMN "reason" varchar(32) NOT NULL DEFAULT \'ambiguous\'');
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE "series_pending_match" DROP COLUMN "reason"');
    }
}
