import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSeriesPendingMatch1785071020000 implements MigrationInterface {
    name = 'AddSeriesPendingMatch1785071020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            'CREATE TABLE `series_pending_match` (`id` int NOT NULL AUTO_INCREMENT, `recordedId` int NOT NULL, `normalizedTitle` text NOT NULL, `channelId` int NOT NULL, `candidatesJson` text NOT NULL, `createdAt` bigint NOT NULL, UNIQUE INDEX `IDX_series_pending_match_recorded` (`recordedId`), PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE `series_pending_match`');
    }
}
