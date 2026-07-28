import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddUser1785102000000 implements MigrationInterface {
    name = 'AddUser1785102000000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query(
            `CREATE TABLE "user" (` +
                `"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, ` +
                `"name" varchar(191) NOT NULL, ` +
                `"passwordHash" text NOT NULL, ` +
                `"tokenVersion" integer NOT NULL DEFAULT (1), ` +
                `"createdAt" bigint NOT NULL, ` +
                `"updatedAt" bigint NOT NULL)`,
        );
        await q.query(`CREATE UNIQUE INDEX "IDX_user_name" ON "user" ("name")`);
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP INDEX "IDX_user_name"`);
        await q.query(`DROP TABLE "user"`);
    }
}
