import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSyobocalTitleDictionary1785093020000 implements MigrationInterface {
    name = 'AddSyobocalTitleDictionary1785093020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            'CREATE TABLE `syobocal_title` (' +
                '`tid` int NOT NULL, ' +
                '`title` text NOT NULL, ' +
                '`lookupKey` varchar(255) NOT NULL, ' +
                '`shortTitle` text NULL, ' +
                '`titleYomi` text NULL, ' +
                '`titleEn` text NULL, ' +
                '`cat` int NULL, ' +
                '`firstYear` int NULL, ' +
                '`firstMonth` int NULL, ' +
                '`totalEpisodes` int NULL, ' +
                '`lastUpdate` varchar(32) NULL, ' +
                '`updatedAt` bigint NOT NULL, ' +
                'INDEX `IDX_syobocal_title_lookup_key` (`lookupKey`), ' +
                'PRIMARY KEY (`tid`)) ENGINE=InnoDB',
        );
        await q.query(
            'CREATE TABLE `syobocal_title_alias` (' +
                '`id` int NOT NULL AUTO_INCREMENT, ' +
                '`lookupKey` varchar(255) NOT NULL, ' +
                '`tid` int NOT NULL, ' +
                '`rank` int NOT NULL DEFAULT 2, ' +
                'INDEX `IDX_syobocal_title_alias_key` (`lookupKey`), ' +
                'INDEX `IDX_syobocal_title_alias_tid` (`tid`), ' +
                'PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
        await q.query(
            'CREATE TABLE `syobocal_title_episode` (' +
                '`id` int NOT NULL AUTO_INCREMENT, ' +
                '`tid` int NOT NULL, ' +
                '`episodeNumber` int NOT NULL, ' +
                '`subTitle` text NOT NULL, ' +
                '`lookupKey` varchar(255) NOT NULL, ' +
                'INDEX `IDX_syobocal_title_episode_tid` (`tid`), ' +
                'INDEX `IDX_syobocal_title_episode_key` (`lookupKey`), ' +
                'PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE `syobocal_title_episode`');
        await q.query('DROP TABLE `syobocal_title_alias`');
        await q.query('DROP TABLE `syobocal_title`');
    }
}
