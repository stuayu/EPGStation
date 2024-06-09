/* eslint-disable max-len */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEventRelay1716647355956 implements MigrationInterface {
    name = 'AddEventRelay1716647355956';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_c5315b388628971c92d241be9c"`);
        await queryRunner.query(`DROP INDEX "IDX_4bf93992f2a6020b74bbf80cf4"`);
        await queryRunner.query(
            `CREATE TABLE "temporary_recorded_tags_recorded_tag" ("recordedId" integer NOT NULL, "recordedTagId" integer NOT NULL, PRIMARY KEY ("recordedId", "recordedTagId"))`,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_recorded_tags_recorded_tag"("recordedId", "recordedTagId") SELECT "recordedId", "recordedTagId" FROM "recorded_tags_recorded_tag"`,
        );
        await queryRunner.query(`DROP TABLE "recorded_tags_recorded_tag"`);
        await queryRunner.query(
            `ALTER TABLE "temporary_recorded_tags_recorded_tag" RENAME TO "recorded_tags_recorded_tag"`,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_c5315b388628971c92d241be9c" ON "recorded_tags_recorded_tag" ("recordedTagId") `,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_4bf93992f2a6020b74bbf80cf4" ON "recorded_tags_recorded_tag" ("recordedId") `,
        );
        await queryRunner.query(
            `CREATE TABLE "temporary_reserve" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "updateTime" bigint NOT NULL, "ruleId" integer, "ruleUpdateCnt" integer, "isSkip" boolean NOT NULL DEFAULT (0), "isConflict" boolean NOT NULL DEFAULT (0), "allowEndLack" boolean NOT NULL DEFAULT (0), "tags" text, "isOverlap" boolean NOT NULL DEFAULT (0), "isIgnoreOverlap" boolean NOT NULL DEFAULT (0), "isTimeSpecified" boolean NOT NULL DEFAULT (0), "parentDirectoryName" text, "directory" text, "recordedFormat" text, "encodeMode1" text, "encodeParentDirectoryName1" text, "encodeDirectory1" text, "encodeMode2" text, "encodeParentDirectoryName2" text, "encodeDirectory2" text, "encodeMode3" text, "encodeParentDirectoryName3" text, "encodeDirectory3" text, "isDeleteOriginalAfterEncode" boolean NOT NULL DEFAULT (0), "programId" bigint, "programUpdateTime" bigint, "channelId" bigint NOT NULL, "channel" text NOT NULL, "channelType" text NOT NULL, "startAt" bigint NOT NULL, "endAt" bigint NOT NULL, "name" text, "halfWidthName" text, "shortName" text, "description" text, "halfWidthDescription" text, "extended" text, "halfWidthExtended" text, "genre1" integer, "subGenre1" integer, "genre2" integer, "subGenre2" integer, "genre3" integer, "subGenre3" integer, "videoType" text, "videoResolution" text, "videoStreamContent" integer, "videoComponentType" integer, "audioSamplingRate" integer, "audioComponentType" integer, "rawExtended" text, "rawHalfWidthExtended" text, "isEventRelay" boolean NOT NULL DEFAULT (0))`,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_reserve"("id", "updateTime", "ruleId", "ruleUpdateCnt", "isSkip", "isConflict", "allowEndLack", "tags", "isOverlap", "isIgnoreOverlap", "isTimeSpecified", "parentDirectoryName", "directory", "recordedFormat", "encodeMode1", "encodeParentDirectoryName1", "encodeDirectory1", "encodeMode2", "encodeParentDirectoryName2", "encodeDirectory2", "encodeMode3", "encodeParentDirectoryName3", "encodeDirectory3", "isDeleteOriginalAfterEncode", "programId", "programUpdateTime", "channelId", "channel", "channelType", "startAt", "endAt", "name", "halfWidthName", "shortName", "description", "halfWidthDescription", "extended", "halfWidthExtended", "genre1", "subGenre1", "genre2", "subGenre2", "genre3", "subGenre3", "videoType", "videoResolution", "videoStreamContent", "videoComponentType", "audioSamplingRate", "audioComponentType", "rawExtended", "rawHalfWidthExtended") SELECT "id", "updateTime", "ruleId", "ruleUpdateCnt", "isSkip", "isConflict", "allowEndLack", "tags", "isOverlap", "isIgnoreOverlap", "isTimeSpecified", "parentDirectoryName", "directory", "recordedFormat", "encodeMode1", "encodeParentDirectoryName1", "encodeDirectory1", "encodeMode2", "encodeParentDirectoryName2", "encodeDirectory2", "encodeMode3", "encodeParentDirectoryName3", "encodeDirectory3", "isDeleteOriginalAfterEncode", "programId", "programUpdateTime", "channelId", "channel", "channelType", "startAt", "endAt", "name", "halfWidthName", "shortName", "description", "halfWidthDescription", "extended", "halfWidthExtended", "genre1", "subGenre1", "genre2", "subGenre2", "genre3", "subGenre3", "videoType", "videoResolution", "videoStreamContent", "videoComponentType", "audioSamplingRate", "audioComponentType", "rawExtended", "rawHalfWidthExtended" FROM "reserve"`,
        );
        await queryRunner.query(`DROP TABLE "reserve"`);
        await queryRunner.query(`ALTER TABLE "temporary_reserve" RENAME TO "reserve"`);
        await queryRunner.query(`DROP INDEX "IDX_c5315b388628971c92d241be9c"`);
        await queryRunner.query(`DROP INDEX "IDX_4bf93992f2a6020b74bbf80cf4"`);
        await queryRunner.query(
            `CREATE TABLE "temporary_recorded_tags_recorded_tag" ("recordedId" integer NOT NULL, "recordedTagId" integer NOT NULL, CONSTRAINT "FK_4bf93992f2a6020b74bbf80cf4c" FOREIGN KEY ("recordedId") REFERENCES "recorded" ("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "FK_c5315b388628971c92d241be9c8" FOREIGN KEY ("recordedTagId") REFERENCES "recorded_tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE, PRIMARY KEY ("recordedId", "recordedTagId"))`,
        );
        await queryRunner.query(
            `INSERT INTO "temporary_recorded_tags_recorded_tag"("recordedId", "recordedTagId") SELECT "recordedId", "recordedTagId" FROM "recorded_tags_recorded_tag"`,
        );
        await queryRunner.query(`DROP TABLE "recorded_tags_recorded_tag"`);
        await queryRunner.query(
            `ALTER TABLE "temporary_recorded_tags_recorded_tag" RENAME TO "recorded_tags_recorded_tag"`,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_c5315b388628971c92d241be9c" ON "recorded_tags_recorded_tag" ("recordedTagId") `,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_4bf93992f2a6020b74bbf80cf4" ON "recorded_tags_recorded_tag" ("recordedId") `,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_4bf93992f2a6020b74bbf80cf4"`);
        await queryRunner.query(`DROP INDEX "IDX_c5315b388628971c92d241be9c"`);
        await queryRunner.query(
            `ALTER TABLE "recorded_tags_recorded_tag" RENAME TO "temporary_recorded_tags_recorded_tag"`,
        );
        await queryRunner.query(
            `CREATE TABLE "recorded_tags_recorded_tag" ("recordedId" integer NOT NULL, "recordedTagId" integer NOT NULL, PRIMARY KEY ("recordedId", "recordedTagId"))`,
        );
        await queryRunner.query(
            `INSERT INTO "recorded_tags_recorded_tag"("recordedId", "recordedTagId") SELECT "recordedId", "recordedTagId" FROM "temporary_recorded_tags_recorded_tag"`,
        );
        await queryRunner.query(`DROP TABLE "temporary_recorded_tags_recorded_tag"`);
        await queryRunner.query(
            `CREATE INDEX "IDX_4bf93992f2a6020b74bbf80cf4" ON "recorded_tags_recorded_tag" ("recordedId") `,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_c5315b388628971c92d241be9c" ON "recorded_tags_recorded_tag" ("recordedTagId") `,
        );
        await queryRunner.query(`ALTER TABLE "reserve" RENAME TO "temporary_reserve"`);
        await queryRunner.query(
            `CREATE TABLE "reserve" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "updateTime" bigint NOT NULL, "ruleId" integer, "ruleUpdateCnt" integer, "isSkip" boolean NOT NULL DEFAULT (0), "isConflict" boolean NOT NULL DEFAULT (0), "allowEndLack" boolean NOT NULL DEFAULT (0), "tags" text, "isOverlap" boolean NOT NULL DEFAULT (0), "isIgnoreOverlap" boolean NOT NULL DEFAULT (0), "isTimeSpecified" boolean NOT NULL DEFAULT (0), "parentDirectoryName" text, "directory" text, "recordedFormat" text, "encodeMode1" text, "encodeParentDirectoryName1" text, "encodeDirectory1" text, "encodeMode2" text, "encodeParentDirectoryName2" text, "encodeDirectory2" text, "encodeMode3" text, "encodeParentDirectoryName3" text, "encodeDirectory3" text, "isDeleteOriginalAfterEncode" boolean NOT NULL DEFAULT (0), "programId" bigint, "programUpdateTime" bigint, "channelId" bigint NOT NULL, "channel" text NOT NULL, "channelType" text NOT NULL, "startAt" bigint NOT NULL, "endAt" bigint NOT NULL, "name" text, "halfWidthName" text, "shortName" text, "description" text, "halfWidthDescription" text, "extended" text, "halfWidthExtended" text, "genre1" integer, "subGenre1" integer, "genre2" integer, "subGenre2" integer, "genre3" integer, "subGenre3" integer, "videoType" text, "videoResolution" text, "videoStreamContent" integer, "videoComponentType" integer, "audioSamplingRate" integer, "audioComponentType" integer, "rawExtended" text, "rawHalfWidthExtended" text)`,
        );
        await queryRunner.query(
            `INSERT INTO "reserve"("id", "updateTime", "ruleId", "ruleUpdateCnt", "isSkip", "isConflict", "allowEndLack", "tags", "isOverlap", "isIgnoreOverlap", "isTimeSpecified", "parentDirectoryName", "directory", "recordedFormat", "encodeMode1", "encodeParentDirectoryName1", "encodeDirectory1", "encodeMode2", "encodeParentDirectoryName2", "encodeDirectory2", "encodeMode3", "encodeParentDirectoryName3", "encodeDirectory3", "isDeleteOriginalAfterEncode", "programId", "programUpdateTime", "channelId", "channel", "channelType", "startAt", "endAt", "name", "halfWidthName", "shortName", "description", "halfWidthDescription", "extended", "halfWidthExtended", "genre1", "subGenre1", "genre2", "subGenre2", "genre3", "subGenre3", "videoType", "videoResolution", "videoStreamContent", "videoComponentType", "audioSamplingRate", "audioComponentType", "rawExtended", "rawHalfWidthExtended") SELECT "id", "updateTime", "ruleId", "ruleUpdateCnt", "isSkip", "isConflict", "allowEndLack", "tags", "isOverlap", "isIgnoreOverlap", "isTimeSpecified", "parentDirectoryName", "directory", "recordedFormat", "encodeMode1", "encodeParentDirectoryName1", "encodeDirectory1", "encodeMode2", "encodeParentDirectoryName2", "encodeDirectory2", "encodeMode3", "encodeParentDirectoryName3", "encodeDirectory3", "isDeleteOriginalAfterEncode", "programId", "programUpdateTime", "channelId", "channel", "channelType", "startAt", "endAt", "name", "halfWidthName", "shortName", "description", "halfWidthDescription", "extended", "halfWidthExtended", "genre1", "subGenre1", "genre2", "subGenre2", "genre3", "subGenre3", "videoType", "videoResolution", "videoStreamContent", "videoComponentType", "audioSamplingRate", "audioComponentType", "rawExtended", "rawHalfWidthExtended" FROM "temporary_reserve"`,
        );
        await queryRunner.query(`DROP TABLE "temporary_reserve"`);
        await queryRunner.query(`DROP INDEX "IDX_4bf93992f2a6020b74bbf80cf4"`);
        await queryRunner.query(`DROP INDEX "IDX_c5315b388628971c92d241be9c"`);
        await queryRunner.query(
            `ALTER TABLE "recorded_tags_recorded_tag" RENAME TO "temporary_recorded_tags_recorded_tag"`,
        );
        await queryRunner.query(
            `CREATE TABLE "recorded_tags_recorded_tag" ("recordedId" integer NOT NULL, "recordedTagId" integer NOT NULL, CONSTRAINT "FK_c5315b388628971c92d241be9c8" FOREIGN KEY ("recordedTagId") REFERENCES "recorded_tag" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_4bf93992f2a6020b74bbf80cf4c" FOREIGN KEY ("recordedId") REFERENCES "recorded" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, PRIMARY KEY ("recordedId", "recordedTagId"))`,
        );
        await queryRunner.query(
            `INSERT INTO "recorded_tags_recorded_tag"("recordedId", "recordedTagId") SELECT "recordedId", "recordedTagId" FROM "temporary_recorded_tags_recorded_tag"`,
        );
        await queryRunner.query(`DROP TABLE "temporary_recorded_tags_recorded_tag"`);
        await queryRunner.query(
            `CREATE INDEX "IDX_4bf93992f2a6020b74bbf80cf4" ON "recorded_tags_recorded_tag" ("recordedId") `,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_c5315b388628971c92d241be9c" ON "recorded_tags_recorded_tag" ("recordedTagId") `,
        );
    }
}
