import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddProgramSeriesLink1785064000000 implements MigrationInterface {
    name = 'AddProgramSeriesLink1785064000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            'CREATE TABLE "program_series_link" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "programId" bigint NOT NULL, "seriesId" integer NOT NULL, "episodeId" integer, "confidence" real NOT NULL DEFAULT (0), "source" text NOT NULL DEFAULT (\'epg\'), "manualLock" boolean NOT NULL DEFAULT (0), "updatedAt" bigint NOT NULL)',
        );
        await q.query('CREATE UNIQUE INDEX "IDX_program_series_link_program" ON "program_series_link" ("programId")');
        await q.query('CREATE INDEX "IDX_program_series_link_series" ON "program_series_link" ("seriesId")');
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE "program_series_link"');
    }
}
