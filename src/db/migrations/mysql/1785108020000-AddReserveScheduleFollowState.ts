import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 予約に EPG 追従の状態を持たせる。
 * isTimeUndefined: 放送終了時刻が未定 (ARIB の duration = 0xFFFFFF)
 * isFollowingSchedule: 前番組の延長などで番組開始を待っている
 */
export class AddReserveScheduleFollowState1785108020000 implements MigrationInterface {
    name = 'AddReserveScheduleFollowState1785108020000';

    public async up(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE \`reserve\` ADD \`isTimeUndefined\` tinyint NOT NULL DEFAULT 0`);
        await q.query(`ALTER TABLE \`reserve\` ADD \`isFollowingSchedule\` tinyint NOT NULL DEFAULT 0`);
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE \`reserve\` DROP COLUMN \`isFollowingSchedule\``);
        await q.query(`ALTER TABLE \`reserve\` DROP COLUMN \`isTimeUndefined\``);
    }
}
