import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecordingSessions1787544000000 implements MigrationInterface {
    name = 'AddRecordingSessions1787544000000';

    public async up(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `recorded` ADD `recordingStatus` text NULL');
        await q.query('ALTER TABLE `recorded` ADD `endReason` text NULL');
        await q.query(`CREATE TABLE \`recording_session\` (
            \`id\` int NOT NULL AUTO_INCREMENT,
            \`reserveId\` int NOT NULL,
            \`recordedId\` int NULL,
            \`programId\` bigint NULL,
            \`channelId\` bigint NOT NULL,
            \`state\` text NOT NULL,
            \`scheduledStartAt\` bigint NOT NULL,
            \`scheduledEndAt\` bigint NOT NULL,
            \`actualStartAt\` bigint NULL,
            \`actualEndAt\` bigint NULL,
            \`startReason\` text NULL,
            \`endReason\` text NULL,
            \`resultStatus\` text NULL,
            \`retryCount\` int NOT NULL DEFAULT 0,
            \`createdAt\` bigint NOT NULL,
            \`updatedAt\` bigint NOT NULL,
            INDEX \`IDX_recording_session_recorded\` (\`recordedId\`),
            PRIMARY KEY (\`id\`)
        ) ENGINE=InnoDB`);
        await q.query(`CREATE TABLE \`recording_attempt\` (
            \`id\` int NOT NULL AUTO_INCREMENT,
            \`sessionId\` int NOT NULL,
            \`attemptNo\` int NOT NULL,
            \`requestedAt\` bigint NOT NULL,
            \`firstDataAt\` bigint NULL,
            \`endedAt\` bigint NULL,
            \`closeReason\` text NULL,
            \`errorCode\` text NULL,
            \`priority\` int NOT NULL,
            \`bytesReceived\` bigint NOT NULL DEFAULT 0,
            \`fileOffsetStart\` bigint NULL,
            \`fileOffsetEnd\` bigint NULL,
            UNIQUE INDEX \`IDX_recording_attempt_session_no\` (\`sessionId\`, \`attemptNo\`),
            PRIMARY KEY (\`id\`),
            CONSTRAINT \`FK_recording_attempt_session\` FOREIGN KEY (\`sessionId\`) REFERENCES \`recording_session\`(\`id\`) ON DELETE CASCADE
        ) ENGINE=InnoDB`);
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE `recording_attempt`');
        await q.query('DROP TABLE `recording_session`');
        await q.query('ALTER TABLE `recorded` DROP COLUMN `endReason`');
        await q.query('ALTER TABLE `recorded` DROP COLUMN `recordingStatus`');
    }
}
