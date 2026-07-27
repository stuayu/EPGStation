import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSeriesAlias1785072020000 implements MigrationInterface {
    name = 'AddSeriesAlias1785072020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            'CREATE TABLE `series_alias` (`id` int NOT NULL AUTO_INCREMENT, `normalizedTitle` varchar(512) NOT NULL, `seriesId` int NOT NULL, `createdAt` bigint NOT NULL, UNIQUE INDEX `IDX_series_alias_normalized_title` (`normalizedTitle`), INDEX `IDX_series_alias_series` (`seriesId`), PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE `series_alias`');
    }
}
