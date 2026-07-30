import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddVideoFileTsInfo1785105020000 implements MigrationInterface {
    name = 'AddVideoFileTsInfo1785105020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(`CREATE TABLE \`video_file_ts_info\` (
            \`videoFileId\` int NOT NULL,
            \`networkId\` int NULL,
            \`transportStreamId\` int NULL,
            \`serviceId\` int NULL,
            \`serviceType\` int NULL,
            \`serviceName\` text NULL,
            \`serviceProviderName\` text NULL,
            \`networkName\` text NULL,
            \`eventId\` int NULL,
            \`eventName\` text NULL,
            \`eventDescription\` text NULL,
            \`eventExtended\` text NULL,
            \`eventStartAt\` bigint NULL,
            \`eventDuration\` int NULL,
            \`genre1\` int NULL,
            \`subGenre1\` int NULL,
            \`genre2\` int NULL,
            \`subGenre2\` int NULL,
            \`genre3\` int NULL,
            \`subGenre3\` int NULL,
            \`videoStreamType\` int NULL,
            \`videoPid\` int NULL,
            \`audioStreamType\` int NULL,
            \`audioPid\` int NULL,
            \`firstTdtAt\` bigint NULL,
            \`analyzedAt\` bigint NOT NULL,
            PRIMARY KEY (\`videoFileId\`),
            INDEX \`IDX_video_file_ts_info_service\` (\`networkId\`, \`serviceId\`),
            CONSTRAINT \`FK_video_file_ts_info_video_file\` FOREIGN KEY (\`videoFileId\`) REFERENCES \`video_file\` (\`id\`) ON DELETE CASCADE
        ) ENGINE=InnoDB`);
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP TABLE \`video_file_ts_info\``);
    }
}
