/* eslint-disable max-len */
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * recorded に録画時点の放送局名を保持するカラムを追加する
 * 転居などで channel テーブルから放送局情報が失われても表示名を復元できるようにするため
 */
export class AddRecordedChannelName1784937600000 implements MigrationInterface {
    name = 'AddRecordedChannelName1784937600000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "recorded" ADD COLUMN "channelName" text`);
        await queryRunner.query(`ALTER TABLE "recorded" ADD COLUMN "halfWidthChannelName" text`);

        // 既存データは現在の channel テーブルから復元する
        await queryRunner.query(
            `UPDATE "recorded" SET "channelName" = (SELECT "name" FROM "channel" WHERE "channel"."id" = "recorded"."channelId"), "halfWidthChannelName" = (SELECT "halfWidthName" FROM "channel" WHERE "channel"."id" = "recorded"."channelId") WHERE EXISTS (SELECT 1 FROM "channel" WHERE "channel"."id" = "recorded"."channelId")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "recorded" DROP COLUMN "halfWidthChannelName"`);
        await queryRunner.query(`ALTER TABLE "recorded" DROP COLUMN "channelName"`);
    }
}
