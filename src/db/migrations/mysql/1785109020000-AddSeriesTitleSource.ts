import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * シリーズの表示名の出所を持たせる。
 * 'dictionary': 作品辞書の正式タイトルへ同期済み / 'manual': 画面から編集 (自動同期で上書きしない)
 */
export class AddSeriesTitleSource1785109020000 implements MigrationInterface {
    name = 'AddSeriesTitleSource1785109020000';

    public async up(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE \`series\` ADD \`titleSource\` text NULL`);
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE \`series\` DROP COLUMN \`titleSource\``);
    }
}
