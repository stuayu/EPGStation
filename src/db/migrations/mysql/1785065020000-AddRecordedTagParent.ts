import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecordedTagParent1785065020000 implements MigrationInterface {
    name = 'AddRecordedTagParent1785065020000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE `recorded_tag` ADD `parentId` int NULL');
        await queryRunner.query('CREATE INDEX `IDX_recorded_tag_parentId` ON `recorded_tag` (`parentId`)');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP INDEX `IDX_recorded_tag_parentId` ON `recorded_tag`');
        await queryRunner.query('ALTER TABLE `recorded_tag` DROP COLUMN `parentId`');
    }
}
