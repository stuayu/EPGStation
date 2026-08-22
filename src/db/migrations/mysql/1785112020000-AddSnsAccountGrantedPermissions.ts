import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSnsAccountGrantedPermissions1785112020000 implements MigrationInterface {
    name = 'AddSnsAccountGrantedPermissions1785112020000';
    async up(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `sns_account` ADD `grantedPermissions` text NULL');
    }
    async down(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `sns_account` DROP COLUMN `grantedPermissions`');
    }
}
