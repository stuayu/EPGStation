import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddNotificationQueue1785092020000 implements MigrationInterface {
    name = 'AddNotificationQueue1785092020000';
    async up(q: QueryRunner): Promise<void> {
        await q.query(
            "CREATE TABLE `notification_queue` (`id` int NOT NULL AUTO_INCREMENT, `targetName` varchar(191) NOT NULL, `eventType` varchar(50) NOT NULL, `payload` longtext NOT NULL, `status` varchar(20) NOT NULL DEFAULT 'pending', `attempts` int NOT NULL DEFAULT 0, `nextAttemptAt` bigint NOT NULL, `lastError` longtext NULL, `createdAt` bigint NOT NULL, `updatedAt` bigint NOT NULL, INDEX `IDX_notification_queue_status` (`status`, `nextAttemptAt`), PRIMARY KEY (`id`)) ENGINE=InnoDB",
        );
    }
    async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE `notification_queue`');
    }
}
