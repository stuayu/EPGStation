import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * video_file に外部取り込みファイル (register モード) かどうかを表すカラムを追加する
 * register モードで取り込んだファイルは削除時に実ファイルを消さないようにするため必要
 */
export class AddVideoFileIsExternal1785067000000 implements MigrationInterface {
    name = 'AddVideoFileIsExternal1785067000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "video_file" ADD COLUMN "isExternalFile" boolean NOT NULL DEFAULT (0)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "video_file" DROP COLUMN "isExternalFile"`);
    }
}
