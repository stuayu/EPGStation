import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddMetadataProviderCache1785063020000 implements MigrationInterface {
    name = 'AddMetadataProviderCache1785063020000';
    async up(q: QueryRunner): Promise<void> {
        await q.query(
            'CREATE TABLE `metadata_provider_cache` (`id` int NOT NULL AUTO_INCREMENT, `provider` varchar(64) NOT NULL, `externalId` varchar(255) NOT NULL, `payload` longtext NOT NULL, `etag` text NULL, `expiresAt` bigint NOT NULL, `updatedAt` bigint NOT NULL, UNIQUE INDEX `IDX_metadata_provider_cache_key` (`provider`, `externalId`), PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
    }
    async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE `metadata_provider_cache`');
    }
}
