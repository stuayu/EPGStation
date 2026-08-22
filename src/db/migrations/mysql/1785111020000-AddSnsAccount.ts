import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSnsAccount1785111020000 implements MigrationInterface {
    name = 'AddSnsAccount1785111020000';
    async up(q: QueryRunner): Promise<void> {
        await q.query(
            'CREATE TABLE `sns_account` (`id` int NOT NULL AUTO_INCREMENT, `provider` varchar(16) NOT NULL, `userId` int NULL, `remoteUserId` varchar(191) NOT NULL, `instanceUrl` varchar(191) NULL, `handle` text NOT NULL, `displayName` text NOT NULL, `avatarUrl` text NULL, `credential` text NOT NULL, `defaultVisibility` varchar(16) NULL, `defaultChannelId` varchar(191) NULL, `defaultChannelName` text NULL, `isDefaultLocalOnly` tinyint NOT NULL DEFAULT 0, `createdAt` bigint NOT NULL, `updatedAt` bigint NOT NULL, UNIQUE INDEX `IDX_sns_account_unique` (`provider`, `userId`, `remoteUserId`, `instanceUrl`), INDEX `IDX_sns_account_user` (`userId`), PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
    }
    async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE `sns_account`');
    }
}
