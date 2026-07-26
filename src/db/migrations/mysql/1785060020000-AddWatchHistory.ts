import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddWatchHistory1785060020000 implements MigrationInterface {
    name = 'AddWatchHistory1785060020000';
    async up(q: QueryRunner): Promise<void> {
        await q.query(
            'CREATE TABLE `watch_history` (`id` int NOT NULL AUTO_INCREMENT, `videoFileId` int NOT NULL, `recordedId` int NOT NULL, `userId` int NULL, `position` int NOT NULL DEFAULT 0, `duration` int NOT NULL DEFAULT 0, `status` text NOT NULL, `updatedAt` bigint NOT NULL, UNIQUE INDEX `IDX_watch_history_video_file_id` (`videoFileId`), INDEX `IDX_watch_history_recorded_id` (`recordedId`), PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
    }
    async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE `watch_history`');
    }
}
