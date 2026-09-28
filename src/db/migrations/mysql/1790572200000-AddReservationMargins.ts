import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReservationMargins1790572200000 implements MigrationInterface {
    name = 'AddReservationMargins1790572200000';

    public async up(q: QueryRunner): Promise<void> {
        for (const table of ['reserve', 'rule', 'recorded']) {
            await q.query(`ALTER TABLE \`${table}\` ADD \`startMarginSec\` int NULL`);
            await q.query(`ALTER TABLE \`${table}\` ADD \`endMarginSec\` int NULL`);
        }
    }

    public async down(q: QueryRunner): Promise<void> {
        for (const table of ['recorded', 'rule', 'reserve']) {
            await q.query(`ALTER TABLE \`${table}\` DROP COLUMN \`endMarginSec\``);
            await q.query(`ALTER TABLE \`${table}\` DROP COLUMN \`startMarginSec\``);
        }
    }
}
