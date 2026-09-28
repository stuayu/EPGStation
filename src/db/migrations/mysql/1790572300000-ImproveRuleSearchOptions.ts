import { MigrationInterface, QueryRunner } from 'typeorm';

export class ImproveRuleSearchOptions1790572300000 implements MigrationInterface {
    name = 'ImproveRuleSearchOptions1790572300000';

    public async up(q: QueryRunner): Promise<void> {
        await q.query("ALTER TABLE `rule` ADD `ignoreKeywordMatch` varchar(3) NOT NULL DEFAULT 'all'");
        for (const column of ['isFuzzy', 'isGenreExclusion', 'isChannelExclusion', 'isTimeExclusion']) {
            await q.query(`ALTER TABLE \`rule\` ADD \`${column}\` tinyint NOT NULL DEFAULT 0`);
        }
    }

    public async down(q: QueryRunner): Promise<void> {
        for (const column of [
            'isTimeExclusion',
            'isChannelExclusion',
            'isGenreExclusion',
            'isFuzzy',
            'ignoreKeywordMatch',
        ]) {
            await q.query(`ALTER TABLE \`rule\` DROP COLUMN \`${column}\``);
        }
    }
}
