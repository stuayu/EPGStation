import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReservationMargins1790572200000 implements MigrationInterface {
    name = 'AddReservationMargins1790572200000';

    public async up(q: QueryRunner): Promise<void> {
        for (const table of ['reserve', 'rule', 'recorded']) {
            await q.query(`ALTER TABLE "${table}" ADD COLUMN "startMarginSec" integer`);
            await q.query(`ALTER TABLE "${table}" ADD COLUMN "endMarginSec" integer`);
        }
    }

    public async down(q: QueryRunner): Promise<void> {
        for (const table of ['recorded', 'rule', 'reserve']) {
            await q.query(`ALTER TABLE "${table}" DROP COLUMN "endMarginSec"`);
            await q.query(`ALTER TABLE "${table}" DROP COLUMN "startMarginSec"`);
        }
    }
}
