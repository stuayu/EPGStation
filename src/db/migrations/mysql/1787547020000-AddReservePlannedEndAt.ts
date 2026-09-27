import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReservePlannedEndAt1787547020000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`reserve\` ADD \`plannedEndAt\` bigint NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`reserve\` DROP COLUMN \`plannedEndAt\``);
    }
}
