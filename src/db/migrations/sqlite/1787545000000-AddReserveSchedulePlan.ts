import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReserveSchedulePlan1787545000000 implements MigrationInterface {
    name = 'AddReserveSchedulePlan1787545000000';

    public async up(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE "reserve" ADD COLUMN "conflictInfo" text');
        await q.query('ALTER TABLE "reserve" ADD COLUMN "plannedTunerIndex" integer');
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE "reserve" DROP COLUMN "plannedTunerIndex"');
        await q.query('ALTER TABLE "reserve" DROP COLUMN "conflictInfo"');
    }
}
