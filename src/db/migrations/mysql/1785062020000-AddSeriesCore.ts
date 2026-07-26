import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSeriesCore1785062020000 implements MigrationInterface {
    name = 'AddSeriesCore1785062020000';

    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            "CREATE TABLE `series` (`id` int NOT NULL AUTO_INCREMENT, `title` text NOT NULL, `normalizedTitle` varchar(512) NOT NULL, `mediaType` varchar(32) NOT NULL DEFAULT 'tv', `preferredChannelId` int NULL, `syobocalTid` int NULL, `annictId` varchar(128) NULL, `tmdbId` int NULL, `createdAt` bigint NOT NULL, `updatedAt` bigint NOT NULL, INDEX `IDX_series_normalized_title` (`normalizedTitle`), PRIMARY KEY (`id`)) ENGINE=InnoDB",
        );
        await q.query(
            'CREATE TABLE `series_episode` (`id` int NOT NULL AUTO_INCREMENT, `seriesId` int NOT NULL, `seasonNumber` int NOT NULL DEFAULT 1, `episodeNumber` double NULL, `episodeLabel` text NULL, `title` text NULL, `airedAt` bigint NULL, `createdAt` bigint NOT NULL, `updatedAt` bigint NOT NULL, UNIQUE INDEX `IDX_series_episode_identity` (`seriesId`, `seasonNumber`, `episodeNumber`), PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
        await q.query(
            "CREATE TABLE `recorded_series_link` (`id` int NOT NULL AUTO_INCREMENT, `recordedId` int NOT NULL, `seriesId` int NOT NULL, `episodeId` int NULL, `airType` varchar(32) NOT NULL DEFAULT 'unknown', `matchMethod` varchar(32) NOT NULL DEFAULT 'title', `confidence` double NOT NULL DEFAULT 0, `manualLock` tinyint NOT NULL DEFAULT 0, `createdAt` bigint NOT NULL, `updatedAt` bigint NOT NULL, UNIQUE INDEX `IDX_recorded_series_link_recorded` (`recordedId`), INDEX `IDX_recorded_series_link_series` (`seriesId`), PRIMARY KEY (`id`)) ENGINE=InnoDB",
        );
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE `recorded_series_link`');
        await q.query('DROP TABLE `series_episode`');
        await q.query('DROP TABLE `series`');
    }
}
