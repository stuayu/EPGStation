import { inject, injectable } from 'inversify';
import { In } from 'typeorm';
import AnnictWork from '../../db/entities/AnnictWork';
import AnnictWorkAlias from '../../db/entities/AnnictWorkAlias';
import IAnnictWorkDB, { AnnictWorkAliasWithLink, AnnictWorkUpsert } from './IAnnictWorkDB';
import IDBOperator from './IDBOperator';

@injectable()
export default class AnnictWorkDB implements IAnnictWorkDB {
    // 1 回の INSERT にまとめる行数 (SQLite のバインド変数上限に掛からないよう小さめにする)
    private static readonly INSERT_CHUNK_SIZE = 200;
    private static readonly DELETE_CHUNK_SIZE = 200;

    constructor(@inject('IDBOperator') private op: IDBOperator) {}

    public async bulkUpsert(values: AnnictWorkUpsert[]): Promise<void> {
        if (values.length === 0) return;
        const connection = await this.op.getConnection();
        const ids = values.map(x => x.work.annictId);

        // 別名は差分更新ではなく都度置き換える (Annict 側での改題・削除に追随するため)
        for (let i = 0; i < ids.length; i += AnnictWorkDB.DELETE_CHUNK_SIZE) {
            const chunk = ids.slice(i, i + AnnictWorkDB.DELETE_CHUNK_SIZE);
            await connection.getRepository(AnnictWorkAlias).delete({ annictId: In(chunk) });
        }

        await this.insertChunked(
            AnnictWork,
            values.map(x => x.work),
            [
                'title',
                'lookupKey',
                'titleEn',
                'titleKana',
                'titleRo',
                'syobocalTid',
                'seasonYear',
                'seasonName',
                'episodesCount',
                'media',
                'imageUrl',
                'imageCopyright',
                'updatedAt',
            ],
            ['annictId'],
        );
        await this.insertChunked(
            AnnictWorkAlias,
            values.flatMap(x => x.aliases),
            null,
            null,
        );
    }

    public async count(): Promise<number> {
        const connection = await this.op.getConnection();
        return await connection.getRepository(AnnictWork).count();
    }

    public async countLinkedToSyobocal(): Promise<number> {
        const connection = await this.op.getConnection();
        return await connection
            .getRepository(AnnictWork)
            .createQueryBuilder('w')
            .where('w.syobocalTid IS NOT NULL')
            .getCount();
    }

    public async listAllAliases(): Promise<AnnictWorkAliasWithLink[]> {
        const connection = await this.op.getConnection();
        const works = await connection
            .getRepository(AnnictWork)
            .find({ select: { annictId: true, lookupKey: true, syobocalTid: true } });
        const linked = new Map(works.map(x => [x.annictId, x.syobocalTid]));
        const aliases = await connection.getRepository(AnnictWorkAlias).find();
        return [
            // 正式タイトル由来のキーは常に最優先 (rank 0)
            ...works.map(x => ({ lookupKey: x.lookupKey, annictId: x.annictId, rank: 0, syobocalTid: x.syobocalTid })),
            ...aliases.map(x => ({
                lookupKey: x.lookupKey,
                annictId: x.annictId,
                rank: x.rank,
                syobocalTid: linked.get(x.annictId) ?? null,
            })),
        ];
    }

    public async get(annictId: number): Promise<AnnictWork | null> {
        const connection = await this.op.getConnection();
        return await connection.getRepository(AnnictWork).findOne({ where: { annictId } });
    }

    public async findBySyobocalTid(syobocalTid: number): Promise<AnnictWork | null> {
        const connection = await this.op.getConnection();
        return await connection.getRepository(AnnictWork).findOne({ where: { syobocalTid } });
    }

    public async clear(): Promise<void> {
        const connection = await this.op.getConnection();
        // TypeORM 1.x では criteria が空の delete() が禁止されているため QueryBuilder を使う
        for (const entity of [AnnictWorkAlias, AnnictWork]) {
            await connection.createQueryBuilder().delete().from(entity).execute();
        }
    }

    /**
     * SQLite のバインド変数上限に掛からないよう分割して INSERT する
     * @param entity 対象エンティティ
     * @param rows 挿入する行
     * @param updateColumns 主キー衝突時に更新する列 (null なら衝突処理なし)
     * @param conflictColumns 衝突判定に使う列
     */
    private async insertChunked(
        entity: any,
        rows: unknown[],
        updateColumns: string[] | null,
        conflictColumns: string[] | null,
    ): Promise<void> {
        if (rows.length === 0) return;
        const connection = await this.op.getConnection();
        for (let i = 0; i < rows.length; i += AnnictWorkDB.INSERT_CHUNK_SIZE) {
            const chunk = rows.slice(i, i + AnnictWorkDB.INSERT_CHUNK_SIZE);
            const builder = connection
                .createQueryBuilder()
                .insert()
                .into(entity)
                .values(chunk as any);
            if (updateColumns !== null && conflictColumns !== null) {
                builder.orUpdate(updateColumns, conflictColumns);
            }
            await builder.execute();
        }
    }
}
