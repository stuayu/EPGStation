import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddThumbnailVariants1785113020000 implements MigrationInterface {
    name = 'AddThumbnailVariants1785113020000';

    public async up(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE \`thumbnail\` ADD \`variant\` varchar(255) NOT NULL DEFAULT 'poster'`);
        await q.query(`ALTER TABLE \`thumbnail\` ADD \`width\` int NULL`);
        await q.query(`ALTER TABLE \`thumbnail\` ADD \`height\` int NULL`);
        await q.query(`ALTER TABLE \`thumbnail\` ADD \`timestamp\` float NULL`);
        await q.query(`ALTER TABLE \`thumbnail\` ADD \`score\` float NULL`);
        await q.query(`ALTER TABLE \`thumbnail\` ADD \`format\` varchar(255) NOT NULL DEFAULT 'jpeg'`);
        await q.query(`ALTER TABLE \`thumbnail\` ADD \`createdAt\` datetime NULL`);
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE \`thumbnail\` DROP COLUMN \`createdAt\``);
        await q.query(`ALTER TABLE \`thumbnail\` DROP COLUMN \`format\``);
        await q.query(`ALTER TABLE \`thumbnail\` DROP COLUMN \`score\``);
        await q.query(`ALTER TABLE \`thumbnail\` DROP COLUMN \`timestamp\``);
        await q.query(`ALTER TABLE \`thumbnail\` DROP COLUMN \`height\``);
        await q.query(`ALTER TABLE \`thumbnail\` DROP COLUMN \`width\``);
        await q.query(`ALTER TABLE \`thumbnail\` DROP COLUMN \`variant\``);
    }
}
