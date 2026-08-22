/* eslint-disable max-len */
import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSnsAccount1785111000000 implements MigrationInterface {
    name = 'AddSnsAccount1785111000000';
    async up(q: QueryRunner): Promise<void> {
        await q.query(
            `CREATE TABLE "sns_account" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "provider" varchar(16) NOT NULL, "userId" integer, "remoteUserId" varchar(191) NOT NULL, "instanceUrl" varchar(191), "handle" text NOT NULL, "displayName" text NOT NULL, "avatarUrl" text, "credential" text NOT NULL, "defaultVisibility" varchar(16), "defaultChannelId" varchar(191), "defaultChannelName" text, "isDefaultLocalOnly" boolean NOT NULL DEFAULT (0), "createdAt" bigint NOT NULL, "updatedAt" bigint NOT NULL)`,
        );
        await q.query(
            `CREATE UNIQUE INDEX "IDX_sns_account_unique" ON "sns_account" ("provider", "userId", "remoteUserId", "instanceUrl")`,
        );
        await q.query(`CREATE INDEX "IDX_sns_account_user" ON "sns_account" ("userId")`);
    }
    async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP INDEX "IDX_sns_account_user"`);
        await q.query(`DROP INDEX "IDX_sns_account_unique"`);
        await q.query(`DROP TABLE "sns_account"`);
    }
}
