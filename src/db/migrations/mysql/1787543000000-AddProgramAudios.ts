import { MigrationInterface, QueryRunner } from 'typeorm';

/** 番組へ Mirakurun の audios[] (音声 ES 一覧) を JSON 文字列で保存する */
export class AddProgramAudios1787543000000 implements MigrationInterface {
    name = 'AddProgramAudios1787543000000';

    public async up(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `program` ADD `audios` text NULL');
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `program` DROP COLUMN `audios`');
    }
}
