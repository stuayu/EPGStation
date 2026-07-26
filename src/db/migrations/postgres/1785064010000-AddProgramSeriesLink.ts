import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddProgramSeriesLink1785064010000 implements MigrationInterface {
    name = 'AddProgramSeriesLink1785064010000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            'CREATE TABLE "program_series_link" ("id" SERIAL NOT NULL, "programId" bigint NOT NULL, "seriesId" integer NOT NULL, "episodeId" integer, "confidence" double precision NOT NULL DEFAULT 0, "source" text NOT NULL DEFAULT \'epg\', "manualLock" boolean NOT NULL DEFAULT false, "updatedAt" bigint NOT NULL, CONSTRAINT "PK_program_series_link" PRIMARY KEY ("id"))',
        );
        await q.query('CREATE UNIQUE INDEX "IDX_program_series_link_program" ON "program_series_link" ("programId")');
        await q.query('CREATE INDEX "IDX_program_series_link_series" ON "program_series_link" ("seriesId")');
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('DROP TABLE "program_series_link"');
    }
}
