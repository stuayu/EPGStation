import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReservationPriorityPolicy1787546000000 implements MigrationInterface {
    name = 'AddReservationPriorityPolicy1787546000000';

    public async up(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `reserve` ADD `priority` int NOT NULL DEFAULT 3');
        await q.query('ALTER TABLE `reserve` ADD `conflictPolicy` text NULL');
        await q.query(
            "UPDATE `reserve` SET `conflictPolicy` = CASE WHEN `allowEndLack` = 1 THEN 'ALLOW_END_LACK' ELSE 'STRICT' END",
        );
        await q.query('ALTER TABLE `reserve` MODIFY `conflictPolicy` text NOT NULL');
        await q.query('ALTER TABLE `rule` ADD `priority` int NOT NULL DEFAULT 3');
        await q.query('ALTER TABLE `rule` ADD `conflictPolicy` text NULL');
        await q.query(
            "UPDATE `rule` SET `conflictPolicy` = CASE WHEN `allowEndLack` = 1 THEN 'ALLOW_END_LACK' ELSE 'STRICT' END",
        );
        await q.query('ALTER TABLE `rule` MODIFY `conflictPolicy` text NOT NULL');
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `rule` DROP COLUMN `conflictPolicy`');
        await q.query('ALTER TABLE `rule` DROP COLUMN `priority`');
        await q.query('ALTER TABLE `reserve` DROP COLUMN `conflictPolicy`');
        await q.query('ALTER TABLE `reserve` DROP COLUMN `priority`');
    }
}
