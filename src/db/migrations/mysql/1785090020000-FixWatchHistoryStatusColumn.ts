import { MigrationInterface, QueryRunner } from 'typeorm';
/**
 * watch_history.status は MySQL では TEXT 列に DEFAULT を付与できないため
 * (エンティティは default: 'unwatched' を宣言しているが DDL には反映されていなかった)、
 * varchar(20) + DEFAULT 'unwatched' に変更してエンティティ定義と一致させる (§S1-3)
 */
export class FixWatchHistoryStatusColumn1785090020000 implements MigrationInterface {
    name = 'FixWatchHistoryStatusColumn1785090020000';
    public async up(q: QueryRunner): Promise<void> {
        await q.query("ALTER TABLE `watch_history` MODIFY `status` varchar(20) NOT NULL DEFAULT 'unwatched'");
    }
    public async down(q: QueryRunner): Promise<void> {
        await q.query('ALTER TABLE `watch_history` MODIFY `status` text NOT NULL');
    }
}
