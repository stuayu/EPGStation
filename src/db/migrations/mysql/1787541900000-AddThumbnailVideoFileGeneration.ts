import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddThumbnailVideoFileGeneration1787541900000 implements MigrationInterface {
    name = 'AddThumbnailVideoFileGeneration1787541900000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE `thumbnail` ADD `videoFileId` int NULL');
        await queryRunner.query('ALTER TABLE `thumbnail` ADD `videoFileSize` bigint NULL');
        await queryRunner.query('ALTER TABLE `thumbnail` ADD `videoFileAnalyzedAt` bigint NULL');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE `thumbnail` DROP COLUMN `videoFileAnalyzedAt`');
        await queryRunner.query('ALTER TABLE `thumbnail` DROP COLUMN `videoFileSize`');
        await queryRunner.query('ALTER TABLE `thumbnail` DROP COLUMN `videoFileId`');
    }
}
