import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddAnnictWatchSync1785080020000 implements MigrationInterface {
    name = 'AddAnnictWatchSync1785080020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            'CREATE TABLE `annict_watch_sync` (' +
                '`id` int NOT NULL AUTO_INCREMENT, ' +
                '`recordedId` int NOT NULL, ' +
                '`seriesId` int NOT NULL, ' +
                '`seriesEpisodeId` int NOT NULL, ' +
                '`annictWorkId` varchar(255) NOT NULL, ' +
                '`episodeNumber` double NOT NULL, ' +
                "`status` varchar(20) NOT NULL DEFAULT 'pending', " +
                '`attempts` int NOT NULL DEFAULT 0, ' +
                '`nextAttemptAt` bigint NOT NULL, ' +
                '`lastError` text NULL, ' +
                '`createdAt` bigint NOT NULL, ' +
                '`updatedAt` bigint NOT NULL, ' +
                'UNIQUE INDEX `IDX_annict_watch_sync_episode` (`seriesId`, `seriesEpisodeId`), ' +
                'INDEX `IDX_annict_watch_sync_status` (`status`, `nextAttemptAt`), ' +
                'PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE `annict_watch_sync`');
    }
}
