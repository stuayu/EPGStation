import { inject, injectable } from 'inversify';
import { EntityManager, In } from 'typeorm';
import SyobocalTitle from '../../db/entities/SyobocalTitle';
import SyobocalTitleAlias from '../../db/entities/SyobocalTitleAlias';
import SyobocalTitleEpisode from '../../db/entities/SyobocalTitleEpisode';
import IDBOperator from './IDBOperator';
import ISyobocalTitleDB, {
    SyobocalTitleAliasRecord,
    SyobocalTitleEpisodeRecord,
    SyobocalTitleSeasonRecord,
    SyobocalTitleUpsert,
} from './ISyobocalTitleDB';

@injectable()
export default class SyobocalTitleDB implements ISyobocalTitleDB {
    // 1 回の INSERT にまとめる行数。SQLite の変数上限 (999) に掛からないよう小さめにする
    private static readonly INSERT_CHUNK_SIZE = 200;
    // TID の IN 句にまとめる件数
    private static readonly DELETE_CHUNK_SIZE = 200;

    constructor(@inject('IDBOperator') private op: IDBOperator) {}

    public async bulkUpsert(values: SyobocalTitleUpsert[]): Promise<void> {
        if (values.length === 0) return;
        const connection = await this.op.getConnection();
        const tids = values.map(x => x.title.tid);

        // 途中で INSERT が失敗した場合に syobocal_title の lastUpdate カーソルだけが進み、
        // 別名・サブタイトルが欠落したままにならないよう、全体を 1 トランザクションで置き換える
        await connection.transaction(async manager => {
            // 同一 TID の別名・サブタイトルは差分更新ではなく都度置き換える (しょぼいカレンダー側での削除に追随するため)
            for (let i = 0; i < tids.length; i += SyobocalTitleDB.DELETE_CHUNK_SIZE) {
                const chunk = tids.slice(i, i + SyobocalTitleDB.DELETE_CHUNK_SIZE);
                await manager.getRepository(SyobocalTitleAlias).delete({ tid: In(chunk) });
                await manager.getRepository(SyobocalTitleEpisode).delete({ tid: In(chunk) });
            }

            await this.insertChunked(
                manager,
                SyobocalTitle,
                values.map(x => x.title),
                true,
            );
            await this.insertChunked(
                manager,
                SyobocalTitleAlias,
                values.flatMap(x => x.aliases),
                false,
            );
            await this.insertChunked(
                manager,
                SyobocalTitleEpisode,
                values.flatMap(x => x.episodes),
                false,
            );
        });
    }

    public async count(): Promise<number> {
        const connection = await this.op.getConnection();
        return await connection.getRepository(SyobocalTitle).count();
    }

    public async getLatestLastUpdate(): Promise<string | null> {
        const connection = await this.op.getConnection();
        const row = await connection
            .getRepository(SyobocalTitle)
            .createQueryBuilder('t')
            .select('MAX(t.lastUpdate)', 'max')
            .getRawOne<{ max: string | null }>();
        return row?.max ?? null;
    }

    public async listAllAliases(): Promise<SyobocalTitleAliasRecord[]> {
        const connection = await this.op.getConnection();
        const titles = await connection.getRepository(SyobocalTitle).find({ select: { tid: true, lookupKey: true } });
        const aliases = await connection.getRepository(SyobocalTitleAlias).find();
        return [
            // 正式タイトル由来のキーは常に最優先 (rank 0)
            ...titles.map(x => ({ lookupKey: x.lookupKey, tid: x.tid, rank: 0 })),
            ...aliases.map(x => ({ lookupKey: x.lookupKey, tid: x.tid, rank: x.rank })),
        ];
    }

    public async listSeasons(): Promise<SyobocalTitleSeasonRecord[]> {
        const connection = await this.op.getConnection();

        return await connection.getRepository(SyobocalTitle).find({
            select: { tid: true, lookupKey: true, firstYear: true, firstMonth: true, totalEpisodes: true },
        });
    }

    public async get(tid: number): Promise<SyobocalTitle | null> {
        const connection = await this.op.getConnection();
        return await connection.getRepository(SyobocalTitle).findOne({ where: { tid } });
    }

    public async listEpisodes(tid: number): Promise<SyobocalTitleEpisodeRecord[]> {
        const connection = await this.op.getConnection();
        return await connection
            .getRepository(SyobocalTitleEpisode)
            .find({ where: { tid }, order: { episodeNumber: 'ASC' } });
    }

    public async clear(): Promise<void> {
        const connection = await this.op.getConnection();
        // TypeORM 1.x では criteria が空の delete() が禁止されているため QueryBuilder を使う
        for (const entity of [SyobocalTitleEpisode, SyobocalTitleAlias, SyobocalTitle]) {
            await connection.createQueryBuilder().delete().from(entity).execute();
        }
    }

    /**
     * SQLite のバインド変数上限に掛からないよう分割して INSERT する
     * @param manager: トランザクション内の EntityManager
     * @param entity: 対象エンティティ
     * @param rows: 挿入する行
     * @param orUpdate: 主キー衝突時に UPDATE するか (syobocal_title のみ true)
     */
    private async insertChunked(
        manager: EntityManager,
        entity: any,
        rows: unknown[],
        orUpdate: boolean,
    ): Promise<void> {
        if (rows.length === 0) return;
        for (let i = 0; i < rows.length; i += SyobocalTitleDB.INSERT_CHUNK_SIZE) {
            const chunk = rows.slice(i, i + SyobocalTitleDB.INSERT_CHUNK_SIZE);
            const builder = manager
                .createQueryBuilder()
                .insert()
                .into(entity)
                .values(chunk as any);
            if (orUpdate === true) {
                builder.orUpdate(
                    [
                        'title',
                        'lookupKey',
                        'shortTitle',
                        'titleYomi',
                        'titleEn',
                        'cat',
                        'firstYear',
                        'firstMonth',
                        'totalEpisodes',
                        'lastUpdate',
                        'updatedAt',
                    ],
                    ['tid'],
                );
            }
            await builder.execute();
        }
    }
}
