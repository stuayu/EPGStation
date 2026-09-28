import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecordingResultMetadata1790572100000 implements MigrationInterface {
    name = 'AddRecordingResultMetadata1790572100000';

    public async up(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `recording_session` ADD `name` text NULL');
        await q.query('ALTER TABLE `recording_session` ADD `ruleId` int NULL');
        await q.query('ALTER TABLE `recording_session` ADD `channelName` text NULL');
        await q.query('ALTER TABLE `recording_session` ADD `isTimeSpecified` tinyint NOT NULL DEFAULT 0');
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `recording_session` DROP COLUMN `isTimeSpecified`');
        await q.query('ALTER TABLE `recording_session` DROP COLUMN `channelName`');
        await q.query('ALTER TABLE `recording_session` DROP COLUMN `ruleId`');
        await q.query('ALTER TABLE `recording_session` DROP COLUMN `name`');
    }
}
