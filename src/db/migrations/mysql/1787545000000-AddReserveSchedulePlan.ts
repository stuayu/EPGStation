import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReserveSchedulePlan1787545000000 implements MigrationInterface {
    name = 'AddReserveSchedulePlan1787545000000';

    public async up(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `reserve` ADD `conflictInfo` text NULL');
        await q.query('ALTER TABLE `reserve` ADD `plannedTunerIndex` int NULL');
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `reserve` DROP COLUMN `plannedTunerIndex`');
        await q.query('ALTER TABLE `reserve` DROP COLUMN `conflictInfo`');
    }
}
