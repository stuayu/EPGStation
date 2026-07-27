import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddAnnictWorkDictionary1785094020000 implements MigrationInterface {
    name = 'AddAnnictWorkDictionary1785094020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            'CREATE TABLE `annict_work` (' +
                '`annictId` int NOT NULL, ' +
                '`title` text NOT NULL, ' +
                '`lookupKey` varchar(255) NOT NULL, ' +
                '`titleEn` text NULL, ' +
                '`titleKana` text NULL, ' +
                '`titleRo` text NULL, ' +
                '`syobocalTid` int NULL, ' +
                '`seasonYear` int NULL, ' +
                '`seasonName` varchar(32) NULL, ' +
                '`episodesCount` int NULL, ' +
                '`media` varchar(32) NULL, ' +
                '`updatedAt` bigint NOT NULL, ' +
                'INDEX `IDX_annict_work_lookup_key` (`lookupKey`), ' +
                'INDEX `IDX_annict_work_syobocal_tid` (`syobocalTid`), ' +
                'PRIMARY KEY (`annictId`)) ENGINE=InnoDB',
        );
        await q.query(
            'CREATE TABLE `annict_work_alias` (' +
                '`id` int NOT NULL AUTO_INCREMENT, ' +
                '`lookupKey` varchar(255) NOT NULL, ' +
                '`annictId` int NOT NULL, ' +
                '`rank` int NOT NULL DEFAULT 2, ' +
                'INDEX `IDX_annict_work_alias_key` (`lookupKey`), ' +
                'INDEX `IDX_annict_work_alias_work` (`annictId`), ' +
                'PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE `annict_work_alias`');
        await q.query('DROP TABLE `annict_work`');
    }
}
