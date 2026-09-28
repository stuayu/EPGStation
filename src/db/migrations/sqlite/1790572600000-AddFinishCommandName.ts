import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFinishCommandName1790572600000 implements MigrationInterface {
    name = 'AddFinishCommandName1790572600000';

    public async up(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE "rule" ADD COLUMN "finishCommandName" text');
        await q.query('ALTER TABLE "reserve" ADD COLUMN "finishCommandName" text');
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE "reserve" DROP COLUMN "finishCommandName"');
        await q.query('ALTER TABLE "rule" DROP COLUMN "finishCommandName"');
    }
}
