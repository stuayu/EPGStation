import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSnsAccountGrantedPermissions1785112000000 implements MigrationInterface {
    name = 'AddSnsAccountGrantedPermissions1785112000000';
    async up(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "sns_account" ADD COLUMN "grantedPermissions" text`);
    }
    async down(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "sns_account" DROP COLUMN "grantedPermissions"`);
    }
}
