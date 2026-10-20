import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientSetting1792490000000 implements MigrationInterface {
    name = 'AddClientSetting1792490000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'CREATE TABLE `client_setting` (`id` int NOT NULL AUTO_INCREMENT, `userId` int NOT NULL, `settings` mediumtext NOT NULL, `updatedAt` bigint NOT NULL, UNIQUE INDEX `IDX_client_setting_userId` (`userId`), PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TABLE `client_setting`');
    }
}
