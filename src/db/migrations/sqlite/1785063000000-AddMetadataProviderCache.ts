import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddMetadataProviderCache1785063000000 implements MigrationInterface {
    name = 'AddMetadataProviderCache1785063000000';
    async up(q: QueryRunner): Promise<void> {
        await q.query(
            'CREATE TABLE "metadata_provider_cache" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "provider" text NOT NULL, "externalId" text NOT NULL, "payload" text NOT NULL, "etag" text, "expiresAt" bigint NOT NULL, "updatedAt" bigint NOT NULL)',
        );
        await q.query(
            'CREATE UNIQUE INDEX "IDX_metadata_provider_cache_key" ON "metadata_provider_cache" ("provider", "externalId")',
        );
    }
    async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE "metadata_provider_cache"');
    }
}
