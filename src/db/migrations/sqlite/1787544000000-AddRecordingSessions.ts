import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecordingSessions1787544000000 implements MigrationInterface {
    name = 'AddRecordingSessions1787544000000';

    public async up(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE "recorded" ADD COLUMN "recordingStatus" text');
        await q.query('ALTER TABLE "recorded" ADD COLUMN "endReason" text');
        await q.query(`CREATE TABLE "recording_session" (
            "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
            "reserveId" integer NOT NULL,
            "recordedId" integer,
            "programId" bigint,
            "channelId" bigint NOT NULL,
            "state" text NOT NULL,
            "scheduledStartAt" bigint NOT NULL,
            "scheduledEndAt" bigint NOT NULL,
            "actualStartAt" bigint,
            "actualEndAt" bigint,
            "startReason" text,
            "endReason" text,
            "resultStatus" text,
            "retryCount" integer NOT NULL DEFAULT (0),
            "createdAt" bigint NOT NULL,
            "updatedAt" bigint NOT NULL
        )`);
        await q.query(`CREATE TABLE "recording_attempt" (
            "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
            "sessionId" integer NOT NULL,
            "attemptNo" integer NOT NULL,
            "requestedAt" bigint NOT NULL,
            "firstDataAt" bigint,
            "endedAt" bigint,
            "closeReason" text,
            "errorCode" text,
            "priority" integer NOT NULL,
            "bytesReceived" bigint NOT NULL DEFAULT (0),
            "fileOffsetStart" bigint,
            "fileOffsetEnd" bigint,
            CONSTRAINT "FK_recording_attempt_session" FOREIGN KEY ("sessionId") REFERENCES "recording_session" ("id") ON DELETE CASCADE
        )`);
        await q.query(
            'CREATE UNIQUE INDEX "IDX_recording_attempt_session_no" ON "recording_attempt" ("sessionId", "attemptNo")',
        );
        await q.query('CREATE INDEX "IDX_recording_session_recorded" ON "recording_session" ("recordedId")');
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP INDEX "IDX_recording_session_recorded"');
        await q.query('DROP INDEX "IDX_recording_attempt_session_no"');
        await q.query('DROP TABLE "recording_attempt"');
        await q.query('DROP TABLE "recording_session"');
        await q.query('ALTER TABLE "recorded" DROP COLUMN "endReason"');
        await q.query('ALTER TABLE "recorded" DROP COLUMN "recordingStatus"');
    }
}
