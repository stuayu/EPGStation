import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddChannelAffiliation1785106000000 implements MigrationInterface {
    name = 'AddChannelAffiliation1785106000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(`CREATE TABLE "channel_affiliation" (
            "networkId" integer NOT NULL,
            "affiliationId" integer NOT NULL,
            "updatedAt" bigint NOT NULL,
            PRIMARY KEY ("networkId", "affiliationId")
        )`);
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP TABLE "channel_affiliation"`);
    }
}
