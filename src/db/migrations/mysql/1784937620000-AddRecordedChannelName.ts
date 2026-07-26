import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * recorded に録画時点の放送局名を保持するカラムを追加する
 * 転居などで channel テーブルから放送局情報が失われても表示名を復元できるようにするため
 */
export class AddRecordedChannelName1784937620000 implements MigrationInterface {
    name = 'AddRecordedChannelName1784937620000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`recorded\` ADD \`channelName\` text NULL`);
        await queryRunner.query(`ALTER TABLE \`recorded\` ADD \`halfWidthChannelName\` text NULL`);

        // 既存データは現在の channel テーブルから復元する
        await queryRunner.query(
            `UPDATE \`recorded\` r INNER JOIN \`channel\` c ON c.\`id\` = r.\`channelId\` SET r.\`channelName\` = c.\`name\`, r.\`halfWidthChannelName\` = c.\`halfWidthName\``,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`recorded\` DROP COLUMN \`halfWidthChannelName\``);
        await queryRunner.query(`ALTER TABLE \`recorded\` DROP COLUMN \`channelName\``);
    }
}
