import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProgramReminder1790572500000 implements MigrationInterface {
    name = 'AddProgramReminder1790572500000';

    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            'CREATE TABLE "program_reminder" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "programId" bigint NOT NULL, "channelId" bigint NOT NULL, "name" text NOT NULL, "startAt" bigint NOT NULL, "minutesBefore" integer NOT NULL DEFAULT (5), "userId" integer, "createdAt" bigint NOT NULL)',
        );
        await q.query('CREATE INDEX "IDX_program_reminder_programId" ON "program_reminder" ("programId")');
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP INDEX "IDX_program_reminder_programId"');
        await q.query('DROP TABLE "program_reminder"');
    }
}
