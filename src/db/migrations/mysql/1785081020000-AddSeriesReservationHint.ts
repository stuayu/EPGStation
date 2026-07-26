import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSeriesReservationHint1785081020000 implements MigrationInterface {
    name = 'AddSeriesReservationHint1785081020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            'CREATE TABLE `series_reservation_hint` (' +
                '`id` int NOT NULL AUTO_INCREMENT, ' +
                '`reserveId` int NOT NULL, ' +
                '`seriesId` int NOT NULL, ' +
                '`episodeId` int NOT NULL, ' +
                '`airType` varchar(20) NOT NULL, ' +
                '`createdAt` bigint NOT NULL, ' +
                'UNIQUE INDEX `IDX_series_reservation_hint_reserve` (`reserveId`), ' +
                'PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE `series_reservation_hint`');
    }
}
