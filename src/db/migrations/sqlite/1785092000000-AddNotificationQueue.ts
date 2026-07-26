import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddNotificationQueue1785092000000 implements MigrationInterface {
    name = 'AddNotificationQueue1785092000000';
    async up(q: QueryRunner): Promise<void> {
        await q.query(
            `CREATE TABLE "notification_queue" (` +
                `"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,` +
                `"targetName" varchar(191) NOT NULL,` +
                `"eventType" varchar(50) NOT NULL,` +
                `"payload" text NOT NULL,` +
                `"status" varchar(20) NOT NULL DEFAULT ('pending'),` +
                `"attempts" integer NOT NULL DEFAULT (0),` +
                `"nextAttemptAt" bigint NOT NULL,` +
                `"lastError" text,` +
                `"createdAt" bigint NOT NULL,` +
                `"updatedAt" bigint NOT NULL)`,
        );
        await q.query(
            `CREATE INDEX "IDX_notification_queue_status" ON "notification_queue" ("status", "nextAttemptAt")`,
        );
    }
    async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP TABLE "notification_queue"`);
    }
}
