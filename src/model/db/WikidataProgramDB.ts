import { inject, injectable } from 'inversify';
import { In } from 'typeorm';
import WikidataProgram from '../../db/entities/WikidataProgram';
import WikidataProgramAlias from '../../db/entities/WikidataProgramAlias';
import IDBOperator from './IDBOperator';
import IWikidataProgramDB, { WikidataProgramAliasWithLink, WikidataProgramUpsert } from './IWikidataProgramDB';

@injectable()
export default class WikidataProgramDB implements IWikidataProgramDB {
    // 1 回の INSERT にまとめる行数 (SQLite のバインド変数上限に掛からないよう小さめにする)
    private static readonly INSERT_CHUNK_SIZE = 200;
    private static readonly DELETE_CHUNK_SIZE = 200;

    constructor(@inject('IDBOperator') private op: IDBOperator) {}

    public async bulkUpsert(values: WikidataProgramUpsert[]): Promise<void> {
        if (values.length === 0) return;
        const connection = await this.op.getConnection();
        const ids = values.map(x => x.program.qid);

        // 別名は差分更新ではなく都度置き換える (Wikidata 側での改名・削除に追随するため)
        for (let i = 0; i < ids.length; i += WikidataProgramDB.DELETE_CHUNK_SIZE) {
            const chunk = ids.slice(i, i + WikidataProgramDB.DELETE_CHUNK_SIZE);
            await connection.getRepository(WikidataProgramAlias).delete({ qid: In(chunk) });
        }

        await this.insertChunked(
            WikidataProgram,
            values.map(x => x.program),
            ['title', 'strictKey', 'syobocalTid', 'tmdbId', 'updatedAt'],
            ['qid'],
        );
        await this.insertChunked(
            WikidataProgramAlias,
            values.flatMap(x => x.aliases),
            null,
            null,
        );
    }

    public async count(): Promise<number> {
        const connection = await this.op.getConnection();
        return await connection.getRepository(WikidataProgram).count();
    }

    public async countLinkedToSyobocal(): Promise<number> {
        const connection = await this.op.getConnection();
        return await connection
            .getRepository(WikidataProgram)
            .createQueryBuilder('p')
            .where('p.syobocalTid IS NOT NULL')
            .getCount();
    }

    public async listAllAliases(): Promise<WikidataProgramAliasWithLink[]> {
        const connection = await this.op.getConnection();
        const programs = await connection
            .getRepository(WikidataProgram)
            .find({ select: { qid: true, strictKey: true, syobocalTid: true } });
        const linked = new Map(programs.map(x => [x.qid, x.syobocalTid]));
        const aliases = await connection.getRepository(WikidataProgramAlias).find();

        return [
            // 正式ラベル由来のキーは常に最優先 (rank 0)
            ...programs.map(x => ({ strictKey: x.strictKey, qid: x.qid, rank: 0, syobocalTid: x.syobocalTid })),
            ...aliases.map(x => ({
                strictKey: x.strictKey,
                qid: x.qid,
                rank: x.rank,
                syobocalTid: linked.get(x.qid) ?? null,
            })),
        ];
    }

    public async get(qid: string): Promise<WikidataProgram | null> {
        const connection = await this.op.getConnection();
        return await connection.getRepository(WikidataProgram).findOne({ where: { qid } });
    }

    public async clear(): Promise<void> {
        const connection = await this.op.getConnection();
        // TypeORM 1.x では criteria が空の delete() が禁止されているため QueryBuilder を使う
        for (const entity of [WikidataProgramAlias, WikidataProgram]) {
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
        for (let i = 0; i < rows.length; i += WikidataProgramDB.INSERT_CHUNK_SIZE) {
            const chunk = rows.slice(i, i + WikidataProgramDB.INSERT_CHUNK_SIZE);
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
