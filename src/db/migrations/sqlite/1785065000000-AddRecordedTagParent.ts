import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddRecordedTagParent1785065000000 implements MigrationInterface {
    name = 'AddRecordedTagParent1785065000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE "recorded_tag" ADD "parentId" integer');
        await q.query('CREATE INDEX "IDX_recorded_tag_parentId" ON "recorded_tag" ("parentId")');
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP INDEX "IDX_recorded_tag_parentId"');
        await q.query('ALTER TABLE "recorded_tag" DROP COLUMN "parentId"');
    }
}
