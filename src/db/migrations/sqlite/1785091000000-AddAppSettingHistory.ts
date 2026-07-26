/* eslint-disable max-len */
import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddAppSettingHistory1785091000000 implements MigrationInterface {
    name = 'AddAppSettingHistory1785091000000';
    async up(q: QueryRunner): Promise<void> {
        await q.query(
            `CREATE TABLE "app_setting_history" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "key" varchar(191) NOT NULL, "previousValue" text NOT NULL, "updatedAt" bigint NOT NULL)`,
        );
        await q.query(`CREATE INDEX "IDX_app_setting_history_key" ON "app_setting_history" ("key", "updatedAt")`);
    }
    async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP TABLE "app_setting_history"`);
    }
}
