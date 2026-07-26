import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddAppSetting1785061000000 implements MigrationInterface {
    name = 'AddAppSetting1785061000000';
    async up(q: QueryRunner) {
        await q.query(
            `CREATE TABLE "app_setting" ("key" text PRIMARY KEY NOT NULL, "value" text NOT NULL, "updatedAt" bigint NOT NULL)`,
        );
    }
    async down(q: QueryRunner) {
        await q.query(`DROP TABLE "app_setting"`);
    }
}
