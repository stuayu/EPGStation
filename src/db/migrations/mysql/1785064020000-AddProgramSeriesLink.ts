import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddProgramSeriesLink1785064020000 implements MigrationInterface {
    name = 'AddProgramSeriesLink1785064020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            "CREATE TABLE `program_series_link` (`id` int NOT NULL AUTO_INCREMENT, `programId` bigint NOT NULL, `seriesId` int NOT NULL, `episodeId` int NULL, `confidence` double NOT NULL DEFAULT 0, `source` varchar(32) NOT NULL DEFAULT 'epg', `manualLock` tinyint NOT NULL DEFAULT 0, `updatedAt` bigint NOT NULL, UNIQUE INDEX `IDX_program_series_link_program` (`programId`), INDEX `IDX_program_series_link_series` (`seriesId`), PRIMARY KEY (`id`)) ENGINE=InnoDB",
        );
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE `program_series_link`');
    }
}
