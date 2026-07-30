import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddVideoFileTsInfo1785105000000 implements MigrationInterface {
    name = 'AddVideoFileTsInfo1785105000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(`CREATE TABLE "video_file_ts_info" (
            "videoFileId" integer PRIMARY KEY NOT NULL,
            "networkId" integer,
            "transportStreamId" integer,
            "serviceId" integer,
            "serviceType" integer,
            "serviceName" text,
            "serviceProviderName" text,
            "networkName" text,
            "eventId" integer,
            "eventName" text,
            "eventDescription" text,
            "eventExtended" text,
            "eventStartAt" bigint,
            "eventDuration" integer,
            "genre1" integer,
            "subGenre1" integer,
            "genre2" integer,
            "subGenre2" integer,
            "genre3" integer,
            "subGenre3" integer,
            "videoStreamType" integer,
            "videoPid" integer,
            "audioStreamType" integer,
            "audioPid" integer,
            "firstTdtAt" bigint,
            "analyzedAt" bigint NOT NULL,
            CONSTRAINT "FK_video_file_ts_info_video_file" FOREIGN KEY ("videoFileId") REFERENCES "video_file" ("id") ON DELETE CASCADE
        )`);
        await q.query(
            `CREATE INDEX "IDX_video_file_ts_info_service" ON "video_file_ts_info" ("networkId", "serviceId")`,
        );
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP INDEX "IDX_video_file_ts_info_service"`);
        await q.query(`DROP TABLE "video_file_ts_info"`);
    }
}
