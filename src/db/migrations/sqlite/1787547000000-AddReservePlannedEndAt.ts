import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReservePlannedEndAt1787547000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "reserve" ADD COLUMN "plannedEndAt" bigint`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "reserve" DROP COLUMN "plannedEndAt"`);
    }
}
