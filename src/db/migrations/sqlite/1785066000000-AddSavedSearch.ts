import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSavedSearch1785066000000 implements MigrationInterface {
    name = 'AddSavedSearch1785066000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            'CREATE TABLE "saved_search" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" text NOT NULL, "query" text NOT NULL, "isPinned" boolean NOT NULL DEFAULT (0), "createdAt" bigint NOT NULL, "updatedAt" bigint NOT NULL)',
        );
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE "saved_search"');
    }
}
