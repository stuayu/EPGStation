import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSeriesAliasSource1785099000000 implements MigrationInterface {
    name = 'AddSeriesAliasSource1785099000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "series_alias" ADD COLUMN "source" text NOT NULL DEFAULT 'manual'`);
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "series_alias" DROP COLUMN "source"`);
    }
}
