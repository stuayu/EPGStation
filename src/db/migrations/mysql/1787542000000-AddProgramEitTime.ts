import { MigrationInterface, QueryRunner } from 'typeorm';

/** 番組へ放送波 EIT[p/f] の時刻と鮮度を保存する */
export class AddProgramEitTime1787542000000 implements MigrationInterface {
    name = 'AddProgramEitTime1787542000000';

    public async up(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `program` ADD `eitReceivedAt` bigint NULL');
        await q.query('ALTER TABLE `program` ADD `eitStartAt` bigint NULL');
        await q.query('ALTER TABLE `program` ADD `eitEndAt` bigint NULL');
        await q.query('ALTER TABLE `program` ADD `eitDurationUndefined` tinyint NOT NULL DEFAULT 0');
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `program` DROP COLUMN `eitDurationUndefined`');
        await q.query('ALTER TABLE `program` DROP COLUMN `eitEndAt`');
        await q.query('ALTER TABLE `program` DROP COLUMN `eitStartAt`');
        await q.query('ALTER TABLE `program` DROP COLUMN `eitReceivedAt`');
    }
}
