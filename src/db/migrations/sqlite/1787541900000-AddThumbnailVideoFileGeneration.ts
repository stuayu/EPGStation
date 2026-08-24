import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddThumbnailVideoFileGeneration1787541900000 implements MigrationInterface {
    name = 'AddThumbnailVideoFileGeneration1787541900000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "thumbnail" ADD COLUMN "videoFileId" integer');
        await queryRunner.query('ALTER TABLE "thumbnail" ADD COLUMN "videoFileSize" bigint');
        await queryRunner.query('ALTER TABLE "thumbnail" ADD COLUMN "videoFileAnalyzedAt" bigint');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "thumbnail" DROP COLUMN "videoFileAnalyzedAt"');
        await queryRunner.query('ALTER TABLE "thumbnail" DROP COLUMN "videoFileSize"');
        await queryRunner.query('ALTER TABLE "thumbnail" DROP COLUMN "videoFileId"');
    }
}
