import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ルール検索の放送波に新4K8K衛星放送 (BS4K / CS4K) を追加する
 */
export class AddRule4KBroadcastWave1785110000000 implements MigrationInterface {
    name = 'AddRule4KBroadcastWave1785110000000';

    public async up(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "rule" ADD COLUMN "BS4K" boolean NOT NULL DEFAULT (0)`);
        await q.query(`ALTER TABLE "rule" ADD COLUMN "CS4K" boolean NOT NULL DEFAULT (0)`);
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "rule" DROP COLUMN "CS4K"`);
        await q.query(`ALTER TABLE "rule" DROP COLUMN "BS4K"`);
    }
}
