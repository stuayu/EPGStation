import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientSetting1792490000000 implements MigrationInterface {
    name = 'AddClientSetting1792490000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'CREATE TABLE "client_setting" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "userId" integer NOT NULL, "settings" text NOT NULL, "updatedAt" bigint NOT NULL)',
        );
        await queryRunner.query('CREATE UNIQUE INDEX "IDX_client_setting_userId" ON "client_setting" ("userId")');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP INDEX "IDX_client_setting_userId"');
        await queryRunner.query('DROP TABLE "client_setting"');
    }
}
