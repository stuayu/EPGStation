import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSeriesChangeHistory1785073020000 implements MigrationInterface {
    name = 'AddSeriesChangeHistory1785073020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            'CREATE TABLE `series_change_history` (`id` int NOT NULL AUTO_INCREMENT, `recordedId` int NOT NULL, `action` varchar(32) NOT NULL, `previousSeriesId` int NULL, `previousEpisodeId` int NULL, `previousAirType` varchar(32) NULL, `previousMatchMethod` varchar(32) NULL, `previousConfidence` double NULL, `previousManualLock` tinyint NULL, `undone` tinyint NOT NULL DEFAULT 0, `createdAt` bigint NOT NULL, INDEX `IDX_series_change_history_recorded` (`recordedId`), INDEX `IDX_series_change_history_created` (`createdAt`), PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE `series_change_history`');
    }
}
