import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddUserRoleAndIdentity1785103000000 implements MigrationInterface {
    name = 'AddUserRoleAndIdentity1785103000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "user" ADD COLUMN "role" varchar(16) NOT NULL DEFAULT 'user'`);
        // 既存ユーザー (パスワード認証で作った最初の管理者) はシステム管理者として扱う
        await q.query(`UPDATE "user" SET "role" = 'admin'`);
        await q.query(
            `CREATE TABLE "user_identity" (` +
                `"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, ` +
                `"userId" integer NOT NULL, ` +
                `"provider" varchar(32) NOT NULL, ` +
                `"providerUserId" varchar(191) NOT NULL, ` +
                `"email" text, ` +
                `"createdAt" bigint NOT NULL, ` +
                `"updatedAt" bigint NOT NULL)`,
        );
        await q.query(
            `CREATE UNIQUE INDEX "IDX_user_identity_provider" ON "user_identity" ("provider", "providerUserId")`,
        );
        await q.query(`CREATE INDEX "IDX_user_identity_user" ON "user_identity" ("userId")`);
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP INDEX "IDX_user_identity_user"`);
        await q.query(`DROP INDEX "IDX_user_identity_provider"`);
        await q.query(`DROP TABLE "user_identity"`);
        await q.query(`ALTER TABLE "user" DROP COLUMN "role"`);
    }
}
