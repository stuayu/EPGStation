import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddRecordedSeriesLinkChannelId1785070020000 implements MigrationInterface {
    name = 'AddRecordedSeriesLinkChannelId1785070020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `recorded_series_link` ADD COLUMN `channelId` int NOT NULL DEFAULT 0');
        await q.query(
            'UPDATE `recorded_series_link` l JOIN `recorded` r ON r.id = l.recordedId SET l.channelId = r.channelId',
        );
        await q.query(
            'CREATE INDEX `IDX_recorded_series_link_series_channel` ON `recorded_series_link` (`seriesId`, `channelId`)',
        );
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP INDEX `IDX_recorded_series_link_series_channel` ON `recorded_series_link`');
        await q.query('ALTER TABLE `recorded_series_link` DROP COLUMN `channelId`');
    }
}
