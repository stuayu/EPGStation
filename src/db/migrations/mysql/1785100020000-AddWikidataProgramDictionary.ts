import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddWikidataProgramDictionary1785100020000 implements MigrationInterface {
    name = 'AddWikidataProgramDictionary1785100020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            'CREATE TABLE `wikidata_program` (`qid` varchar(32) NOT NULL, `title` text NOT NULL, `strictKey` varchar(512) NOT NULL, `syobocalTid` int NULL, `tmdbId` int NULL, `updatedAt` bigint NOT NULL, INDEX `IDX_wikidata_program_strict_key` (`strictKey`), INDEX `IDX_wikidata_program_syobocal_tid` (`syobocalTid`), PRIMARY KEY (`qid`)) ENGINE=InnoDB',
        );
        await q.query(
            'CREATE TABLE `wikidata_program_alias` (`id` int NOT NULL AUTO_INCREMENT, `strictKey` varchar(512) NOT NULL, `qid` varchar(32) NOT NULL, `rank` int NOT NULL DEFAULT 2, INDEX `IDX_wikidata_program_alias_key` (`strictKey`), INDEX `IDX_wikidata_program_alias_program` (`qid`), PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE `wikidata_program_alias`');
        await q.query('DROP TABLE `wikidata_program`');
    }
}
