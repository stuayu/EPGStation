import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddUser1785102020000 implements MigrationInterface {
    name = 'AddUser1785102020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            'CREATE TABLE `user` (' +
                '`id` int NOT NULL AUTO_INCREMENT, ' +
                '`name` varchar(191) NOT NULL, ' +
                '`passwordHash` text NOT NULL, ' +
                '`tokenVersion` int NOT NULL DEFAULT 1, ' +
                '`createdAt` bigint NOT NULL, ' +
                '`updatedAt` bigint NOT NULL, ' +
                'UNIQUE INDEX `IDX_user_name` (`name`), ' +
                'PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE `user`');
    }
}
