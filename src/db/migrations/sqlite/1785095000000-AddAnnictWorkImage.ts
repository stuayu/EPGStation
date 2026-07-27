import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddAnnictWorkImage1785095000000 implements MigrationInterface {
    name = 'AddAnnictWorkImage1785095000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "annict_work" ADD COLUMN "imageUrl" text`);
        await q.query(`ALTER TABLE "annict_work" ADD COLUMN "imageCopyright" text`);
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "annict_work" DROP COLUMN "imageCopyright"`);
        await q.query(`ALTER TABLE "annict_work" DROP COLUMN "imageUrl"`);
    }
}
