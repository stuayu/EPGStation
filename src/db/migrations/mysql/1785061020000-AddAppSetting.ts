import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAppSetting1785061020000 implements MigrationInterface {
    name = 'AddAppSetting1785061020000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'CREATE TABLE `app_setting` (`key` varchar(191) NOT NULL, `value` longtext NOT NULL, `updatedAt` bigint NOT NULL, PRIMARY KEY (`key`)) ENGINE=InnoDB',
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TABLE `app_setting`');
    }
}
