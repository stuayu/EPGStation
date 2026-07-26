import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddAppSetting1785061010000 implements MigrationInterface {
    name = 'AddAppSetting1785061010000';
    async up(q: QueryRunner) {
        await q.query(
            `CREATE TABLE "app_setting" ("key" text NOT NULL, "value" text NOT NULL, "updatedAt" bigint NOT NULL, CONSTRAINT "PK_app_setting" PRIMARY KEY ("key"))`,
        );
    }
    async down(q: QueryRunner) {
        await q.query(`DROP TABLE "app_setting"`);
    }
}
