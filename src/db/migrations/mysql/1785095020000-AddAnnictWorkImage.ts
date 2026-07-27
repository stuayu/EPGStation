import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddAnnictWorkImage1785095020000 implements MigrationInterface {
    name = 'AddAnnictWorkImage1785095020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `annict_work` ADD `imageUrl` text NULL');
        await q.query('ALTER TABLE `annict_work` ADD `imageCopyright` text NULL');
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `annict_work` DROP COLUMN `imageCopyright`');
        await q.query('ALTER TABLE `annict_work` DROP COLUMN `imageUrl`');
    }
}
