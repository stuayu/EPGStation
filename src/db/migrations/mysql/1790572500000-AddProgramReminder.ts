import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProgramReminder1790572500000 implements MigrationInterface {
    name = 'AddProgramReminder1790572500000';

    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            'CREATE TABLE `program_reminder` (`id` int NOT NULL AUTO_INCREMENT, `programId` bigint NOT NULL, `channelId` bigint NOT NULL, `name` text NOT NULL, `startAt` bigint NOT NULL, `minutesBefore` int NOT NULL DEFAULT 5, `userId` int NULL, `createdAt` bigint NOT NULL, INDEX `IDX_program_reminder_programId` (`programId`), PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE `program_reminder`');
    }
}
