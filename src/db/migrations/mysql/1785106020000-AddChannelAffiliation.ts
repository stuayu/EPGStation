import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddChannelAffiliation1785106020000 implements MigrationInterface {
    name = 'AddChannelAffiliation1785106020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(`CREATE TABLE \`channel_affiliation\` (
            \`networkId\` int NOT NULL,
            \`affiliationId\` int NOT NULL,
            \`updatedAt\` bigint NOT NULL,
            PRIMARY KEY (\`networkId\`, \`affiliationId\`)
        ) ENGINE=InnoDB`);
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP TABLE \`channel_affiliation\``);
    }
}
