import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSavedSearch1785066020000 implements MigrationInterface {
    name = 'AddSavedSearch1785066020000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'CREATE TABLE `saved_search` (`id` int NOT NULL AUTO_INCREMENT, `name` text NOT NULL, `query` text NOT NULL, `isPinned` tinyint NOT NULL DEFAULT 0, `createdAt` bigint NOT NULL, `updatedAt` bigint NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TABLE `saved_search`');
    }
}
