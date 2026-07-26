import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddMetadataProviderCache1785063010000 implements MigrationInterface {
    name = 'AddMetadataProviderCache1785063010000';
    async up(q: QueryRunner): Promise<void> {
        await q.query(
            'CREATE TABLE "metadata_provider_cache" ("id" SERIAL NOT NULL, "provider" text NOT NULL, "externalId" text NOT NULL, "payload" text NOT NULL, "etag" text, "expiresAt" bigint NOT NULL, "updatedAt" bigint NOT NULL, CONSTRAINT "PK_metadata_provider_cache" PRIMARY KEY ("id"))',
        );
        await q.query(
            'CREATE UNIQUE INDEX "IDX_metadata_provider_cache_key" ON "metadata_provider_cache" ("provider", "externalId")',
        );
    }
    async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE "metadata_provider_cache"');
    }
}
