import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddUserRoleAndIdentity1785103020000 implements MigrationInterface {
    name = 'AddUserRoleAndIdentity1785103020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query("ALTER TABLE `user` ADD `role` varchar(16) NOT NULL DEFAULT 'user'");
        // 既存ユーザー (パスワード認証で作った最初の管理者) はシステム管理者として扱う
        await q.query("UPDATE `user` SET `role` = 'admin'");
        await q.query(
            'CREATE TABLE `user_identity` (' +
                '`id` int NOT NULL AUTO_INCREMENT, ' +
                '`userId` int NOT NULL, ' +
                '`provider` varchar(32) NOT NULL, ' +
                '`providerUserId` varchar(191) NOT NULL, ' +
                '`email` text NULL, ' +
                '`createdAt` bigint NOT NULL, ' +
                '`updatedAt` bigint NOT NULL, ' +
                'UNIQUE INDEX `IDX_user_identity_provider` (`provider`, `providerUserId`), ' +
                'INDEX `IDX_user_identity_user` (`userId`), ' +
                'PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE `user_identity`');
        await q.query('ALTER TABLE `user` DROP COLUMN `role`');
    }
}
