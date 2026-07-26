import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddAppSettingHistory1785091020000 implements MigrationInterface {
    name = 'AddAppSettingHistory1785091020000';
    async up(q: QueryRunner): Promise<void> {
        await q.query(
            'CREATE TABLE `app_setting_history` (`id` int NOT NULL AUTO_INCREMENT, `key` varchar(191) NOT NULL, `previousValue` longtext NOT NULL, `updatedAt` bigint NOT NULL, INDEX `IDX_app_setting_history_key` (`key`, `updatedAt`), PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
    }
    async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE `app_setting_history`');
    }
}
