import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * channelId は networkId * 100000 + serviceId で生成され、BS/CS などでは int の上限
 * (2147483647) を超える値になる。int のままだと series backfill などで
 * ER_WARN_DATA_OUT_OF_RANGE (Out of range value for column 'channelId') が発生するため
 * bigint へ広げる。recorded.channelId など既存テーブルは元々 bigint であり、それに合わせる。
 * (SQLite は INTEGER が 64bit のため対応不要)
 */
export class WidenSeriesChannelIdColumns1785098020000 implements MigrationInterface {
    name = 'WidenSeriesChannelIdColumns1785098020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `series` MODIFY `preferredChannelId` bigint NULL');
        await q.query('ALTER TABLE `recorded_series_link` MODIFY `channelId` bigint NOT NULL DEFAULT 0');
        await q.query('ALTER TABLE `series_pending_match` MODIFY `channelId` bigint NOT NULL');
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `series` MODIFY `preferredChannelId` int NULL');
        await q.query('ALTER TABLE `recorded_series_link` MODIFY `channelId` int NOT NULL DEFAULT 0');
        await q.query('ALTER TABLE `series_pending_match` MODIFY `channelId` int NOT NULL');
    }
}
