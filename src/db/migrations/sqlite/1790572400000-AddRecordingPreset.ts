import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecordingPreset1790572400000 implements MigrationInterface {
    name = 'AddRecordingPreset1790572400000';

    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            'CREATE TABLE "recording_preset" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" text NOT NULL, "isDefault" boolean NOT NULL DEFAULT (0), "settings" text NOT NULL, "createdAt" bigint NOT NULL, "updatedAt" bigint NOT NULL)',
        );
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE "recording_preset"');
    }
}
