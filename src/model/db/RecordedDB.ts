import { inject, injectable } from 'inversify';
import { DataSource, In, IsNull, Not, SelectQueryBuilder } from 'typeorm';
import * as apid from '../../../api';
import Recorded from '../../db/entities/Recorded';
import RecordedSeriesLink from '../../db/entities/RecordedSeriesLink';
import SeriesPendingMatch from '../../db/entities/SeriesPendingMatch';
import Thumbnail from '../../db/entities/Thumbnail';
import VideoFile from '../../db/entities/VideoFile';
import { isFeatureEnabled } from '../FeatureFlags';
import IConfiguration from '../IConfiguration';
import RecordedKeywordSearch, { buildRecordedKeywordSearchPlan } from '../recorded/RecordedKeywordSearch';
import IPromiseRetry from '../IPromiseRetry';
import IDBOperator from './IDBOperator';
import IRecordedDB, {
    FindAllOption,
    RecordedChannelUpdateValues,
    RecordedColumnOption,
    RecordedProgramUpdateValues,
    SeriesBackfillCandidateRow,
    SeriesBackfillFilter,
} from './IRecordedDB';
import IRecordedTagDB from './IRecordedTagDB';

@injectable()
export default class RecordedDB implements IRecordedDB {
    private op: IDBOperator;
    private promieRetry: IPromiseRetry;
    private config: IConfiguration;
    private recordedTagDB: IRecordedTagDB;

    constructor(
        @inject('IDBOperator') op: IDBOperator,
        @inject('IPromiseRetry') promieRetry: IPromiseRetry,
        @inject('IConfiguration') config: IConfiguration,
        @inject('IRecordedTagDB') recordedTagDB: IRecordedTagDB,
    ) {
        this.op = op;
        this.promieRetry = promieRetry;
        this.config = config;
        this.recordedTagDB = recordedTagDB;
    }

    /**
     * バックアップから復元
     * @param items: Recorded[]
     * @return Promise<void>
     */
    public async restore(items: Recorded[]): Promise<void> {
        // get queryRunner
        const connection = await this.op.getConnection();
        const queryRunner = connection.createQueryRunner();

        // start transaction
        await queryRunner.startTransaction();

        let hasError = false;
        try {
            // 削除
            await queryRunner.manager.createQueryBuilder().delete().from(Thumbnail).execute();
            await queryRunner.manager.createQueryBuilder().delete().from(VideoFile).execute();
            await queryRunner.manager.createQueryBuilder().delete().from(RecordedSeriesLink).execute();
            await queryRunner.manager.createQueryBuilder().delete().from(SeriesPendingMatch).execute();
            await queryRunner.manager.createQueryBuilder().delete().from(Recorded).execute();

            // 挿入処理
            for (const item of items) {
                await queryRunner.manager.insert(Recorded, item);
            }
            await queryRunner.commitTransaction();
        } catch (err: any) {
            console.error(err);
            hasError = err;
            await queryRunner.rollbackTransaction();
        } finally {
            await queryRunner.release();
        }

        if (hasError) {
            throw new Error('restore error');
        }
    }

    /**
     * 録画番組情報を 1 件挿入
     * @param recorded: Recorded
     * @return inserted id
     */
    public async insertOnce(recorded: Recorded): Promise<apid.RecordedId> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().insert().into(Recorded).values(recorded);
        const insertedResult = await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });

        return insertedResult.identifiers[0].id;
    }

    /**
     * 録画番組情報の更新
     * @param recorded: Recorded
     * @return Promise<void>
     */
    public async updateOnce(recorded: Recorded): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().update(Recorded).set(recorded).where({ id: recorded.id });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 放送局の情報 (channelId と表示名) を更新する。
     * TS 解析で放送局が特定できた録画に対して使う
     * @param recordedId: apid.RecordedId
     * @param values: RecordedChannelUpdateValues
     * @return Promise<void>
     */
    public async updateChannel(recordedId: apid.RecordedId, values: RecordedChannelUpdateValues): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().update(Recorded).set(values).where({ id: recordedId });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定した録画情報の番組情報 (概要・詳細・ジャンル・映像音声情報) を更新する。
     * TS 解析から未設定の項目を補完する用途で使う
     * @param recordedId: apid.RecordedId
     * @param values: RecordedProgramUpdateValues 更新する項目だけを持つオブジェクト
     * @return Promise<void>
     */
    public async updateProgramInfo(recordedId: apid.RecordedId, values: RecordedProgramUpdateValues): Promise<void> {
        if (Object.keys(values).length === 0) {
            return;
        }

        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().update(Recorded).set(values).where({ id: recordedId });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定した録画情報の isRecording を false に
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async removeRecording(recordedId: apid.RecordedId): Promise<void> {
        const recorded = await this.findId(recordedId);
        if (recorded === null) {
            throw new Error('RecordedIsNull');
        }

        // すでに有効か
        if (recorded.isRecording === false) {
            return;
        }

        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(Recorded)
            .set({
                isRecording: false,
            })
            .where({ id: recordedId });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定した drop log file id を削除する
     * @param dropLogFileId: apid,DropLogFileId
     * @return Promise<void>
     */
    public async removeDropLogFileId(dropLogFileId: apid.DropLogFileId): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(Recorded)
            .set({
                dropLogFileId: null,
            })
            .where({ dropLogFileId: dropLogFileId });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定した ruleId を削除する
     * @param ruleId: apid.RuleId
     * @return Promise<void>
     */
    public async removeRuleId(ruleId: apid.RuleId): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(Recorded)
            .set({
                ruleId: null,
            })
            .where({ ruleId: ruleId });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 保護状態を変更する
     * @param recordedId: apid.RecordedId
     * @param isProtect: boolean
     * @return Promise<void>
     */
    public async changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void> {
        const recorded = await this.findId(recordedId);
        if (recorded === null) {
            throw new Error('RecordedIsNull');
        }

        // すでに同じ状態であれば何もしない
        if (recorded.isProtected === isProtect) {
            return;
        }

        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(Recorded)
            .set({
                isProtected: isProtect,
            })
            .where({ id: recordedId });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定した録画番組情報を 1 件削除
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async deleteOnce(recordedId: apid.RecordedId): Promise<void> {
        const connection = await this.op.getConnection();
        // シリーズ管理系の孤立行 (recorded_series_link / series_pending_match) を残さないよう先に削除する
        await this.promieRetry.run(() => {
            return connection.createQueryBuilder().delete().from(RecordedSeriesLink).where({ recordedId }).execute();
        });
        await this.promieRetry.run(() => {
            return connection.createQueryBuilder().delete().from(SeriesPendingMatch).where({ recordedId }).execute();
        });
        const queryBuilder = connection.createQueryBuilder().delete().from(Recorded).where({
            id: recordedId,
        });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * id を指定して録画番組情報取得
     * @param recordedId: apid.RecordedId
     * @return Recorded
     */
    public async findId(recordedId: apid.RecordedId): Promise<Recorded | null> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .where({ id: recordedId })
            .leftJoinAndSelect('recorded.videoFiles', 'videoFiles')
            .leftJoinAndSelect('recorded.thumbnails', 'thumbnails')
            .leftJoinAndSelect('recorded.dropLogFile', 'dropLogFile')
            .leftJoinAndSelect('recorded.tags', 'tags');
        const result = await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });

        return result.length === 0 ? null : result[0];
    }

    /**
     * id を複数指定して番組情報を取得する
     * @param recordedIds: apid.RecordedId[]
     * @return Promise<Recorded[]>
     */
    public async findIds(
        recordedIds: apid.RecordedId[],
        columnOption?: RecordedColumnOption,
        isReverse?: boolean,
    ): Promise<Recorded[]> {
        if (recordedIds.length === 0) {
            return [];
        }

        const connection = await this.op.getConnection();

        let queryBuilder = connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .where({ id: In(recordedIds) });

        if (typeof columnOption === 'undefined') {
            queryBuilder = queryBuilder
                .leftJoinAndSelect('recorded.videoFiles', 'videoFiles')
                .leftJoinAndSelect('recorded.thumbnails', 'thumbnails');
        } else {
            // videoFile
            if (columnOption.isNeedVideoFiles === true) {
                queryBuilder = queryBuilder.leftJoinAndSelect('recorded.videoFiles', 'videoFiles');
            }
            // thumbnail
            if (columnOption.isNeedThumbnails === true) {
                queryBuilder = queryBuilder.leftJoinAndSelect('recorded.thumbnails', 'thumbnails');
            }
            // dropLogFile
            if (columnOption.isNeedsDropLog === true) {
                queryBuilder = queryBuilder.leftJoinAndSelect('recorded.dropLogFile', 'dropLogFile');
            }

            // tags
            if (columnOption.isNeedTags === true) {
                queryBuilder = queryBuilder.leftJoinAndSelect('recorded.tags', 'tags');
            }
        }

        queryBuilder = queryBuilder.orderBy('recorded.startAt', isReverse ? 'ASC' : 'DESC');

        const result = await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });

        return result;
    }

    /**
     * 全件取得
     * @param option: FindAllOption
     * @param columnOption: RecordedColumnOption
     * @return Promise<[Recorded[], number]>
     */
    public async findAll(option: FindAllOption, columnOption: RecordedColumnOption): Promise<[Recorded[], number]> {
        const connection = await this.op.getConnection();

        let queryBuilder = connection.getRepository(Recorded).createQueryBuilder('recorded');

        const querys: { query: string; values: any }[] = [];

        // is recording
        if (typeof option.isRecording !== 'undefined') {
            querys.push({
                query: 'recorded.isRecording = :isRecording',
                values: {
                    isRecording: option.isRecording,
                },
            });
        }

        // rule id
        if (typeof option.ruleId !== 'undefined') {
            if (option.ruleId === 0) {
                querys.push({
                    query: 'recorded.ruleId is null',
                    values: {},
                });
            } else {
                querys.push({
                    query: 'recorded.ruleId = :ruleId',
                    values: {
                        ruleId: option.ruleId,
                    },
                });
            }
        }

        // channel id
        if (typeof option.channelId !== 'undefined') {
            querys.push({
                query: 'recorded.channelId = :channelId',
                values: {
                    channelId: option.channelId,
                },
            });
        }

        // genre
        if (typeof option.genre !== 'undefined') {
            querys.push({
                query: '(genre1 = :genre or genre2 = :genre or genre3 = :genre)',
                values: {
                    genre: option.genre,
                },
            });
        }

        // tagId (advancedSearch 有効時は子孫タグの録画も含める)
        if (typeof option.tagId !== 'undefined') {
            let tagIds: number[] = [option.tagId];
            if (isFeatureEnabled(this.config.getConfig(), 'advancedSearch')) {
                const descendantIds = await this.recordedTagDB.getDescendantIds(option.tagId);
                tagIds = [option.tagId, ...descendantIds];
            }

            querys.push({
                query:
                    `exists (select 1 from ${RecordedKeywordSearch.TAG_RELATION_TABLE} tagFilter_rel` +
                    ' where tagFilter_rel.recordedId = recorded.id' +
                    ' and tagFilter_rel.recordedTagId in (:...tagFilterIds))',
                values: {
                    tagFilterIds: tagIds,
                },
            });
        }

        // keyword
        if (typeof option.keyword !== 'undefined') {
            const searchPlan = buildRecordedKeywordSearchPlan(
                option.keyword,
                this.op.getLikeStr(false),
                isFeatureEnabled(this.config.getConfig(), 'advancedSearch'),
            );
            querys.push(...searchPlan.conditions);
        }

        // オリジナルファイルだけを抽出する
        if (columnOption.isNeedVideoFiles === true && !!option.hasOriginalFile === true) {
            querys.push({
                query: 'videoFiles.type <> :type',
                values: {
                    type: 'encoded',
                },
            });
        }

        // where セット
        for (const q of querys) {
            queryBuilder = queryBuilder.andWhere(q.query, q.values);
        }

        // offset
        if (typeof option.offset !== 'undefined') {
            queryBuilder.skip(option.offset);
        }

        // limit
        if (typeof option.limit !== 'undefined') {
            queryBuilder.take(option.limit);
        }

        // order by
        queryBuilder = queryBuilder.orderBy('recorded.startAt', option.isReverse ? 'ASC' : 'DESC');

        // videoFiles
        if (columnOption.isNeedVideoFiles === true) {
            queryBuilder = queryBuilder.leftJoinAndSelect('recorded.videoFiles', 'videoFiles');
        }

        if (!!option.hasOriginalFile === false) {
            // thumbnails
            if (columnOption.isNeedThumbnails === true) {
                queryBuilder = queryBuilder.leftJoinAndSelect('recorded.thumbnails', 'thumbnails');
            }

            // dropLogFile
            if (columnOption.isNeedsDropLog === true) {
                queryBuilder = queryBuilder.leftJoinAndSelect('recorded.dropLogFile', 'dropLogFile');
            }

            // tags
            if (columnOption.isNeedTags === true) {
                queryBuilder = queryBuilder.leftJoinAndSelect('recorded.tags', 'tags');
            }

            return await this.promieRetry.run(() => {
                return queryBuilder.getManyAndCount();
            });
        } else {
            // option.hasOriginalFile が有効な場合は エンコード済みビデオを取得できないので id を指定して再取得する
            const [records, total] = await this.promieRetry.run(() => {
                return queryBuilder.getManyAndCount();
            });

            const recordedIds = records.map(r => {
                return r.id;
            });

            const result = await this.promieRetry.run(() => {
                return this.findIds(recordedIds, columnOption, option.isReverse);
            });

            return [result, total];
        }
    }

    /**
     * channelIdのリストを返す
     * @return Promise<apid.RecordedChannelListItem[]>
     */
    public async findChannelList(): Promise<apid.RecordedChannelListItem[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = await connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .select('count(*) as cnt, channelId')
            .groupBy('channelId');

        return await this.promieRetry.run(() => {
            return queryBuilder.getRawMany();
        });
    }

    /**
     * genreのリストを返す
     * @return Promise<apid.RecordedGenreListItem[]>
     */
    public async findGenreList(): Promise<apid.RecordedGenreListItem[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = await connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .select('count(*) as cnt, genre1 as genre')
            .where({ genre1: Not(IsNull()) })
            .groupBy('genre');

        return await this.promieRetry.run(() => {
            return queryBuilder.getRawMany();
        });
    }

    /**
     * 外部録画ファイル取り込み時の重複検出用に、指定した channelId + 時刻 (許容誤差付き) に一致する recorded を探す
     * @param channelId: apid.ChannelId
     * @param startAt: number 開始時刻 (UnixTime ms)
     * @param toleranceMs: number 許容する時刻差 (ms)
     * @return Promise<Recorded[]>
     */
    public async findDuplicateCandidates(
        channelId: apid.ChannelId,
        startAt: number,
        toleranceMs: number,
    ): Promise<Recorded[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .where('recorded.channelId = :channelId', { channelId })
            .andWhere('recorded.startAt >= :from', { from: startAt - toleranceMs })
            .andWhere('recorded.startAt <= :to', { to: startAt + toleranceMs })
            .leftJoinAndSelect('recorded.videoFiles', 'videoFiles');

        return await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });
    }

    /**
     * 一番古い番組を返す
     * @return Promise<Recorded | null>
     */
    public async findOld(): Promise<Recorded | null> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .where({
                isProtected: false,
            })
            .orderBy('recorded.startAt', 'ASC')
            .orderBy('recorded.id', 'ASC')
            .leftJoinAndSelect('recorded.videoFiles', 'videoFiles')
            .leftJoinAndSelect('recorded.thumbnails', 'thumbnails')
            .leftJoinAndSelect('recorded.dropLogFile', 'dropLogFile')
            .leftJoinAndSelect('recorded.tags', 'tags');
        const result = await this.promieRetry.run(() => {
            return queryBuilder.getOne();
        });

        return typeof result === 'undefined' ? null : result;
    }

    /**
     * 指定した reserveId の録画を返す
     * @param reserveId: apid.ReserveId
     * @return Promise<Recorded[]>
     */
    public async findReserveId(reserveId: apid.ReserveId): Promise<Recorded[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .where({ reserveId: reserveId })
            .leftJoinAndSelect('recorded.videoFiles', 'videoFiles')
            .leftJoinAndSelect('recorded.thumbnails', 'thumbnails')
            .leftJoinAndSelect('recorded.dropLogFile', 'dropLogFile')
            .leftJoinAndSelect('recorded.tags', 'tags');

        return await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });
    }

    /**
     * シリーズ化バックフィル用に録画を id 昇順でチャンク取得する (録画中のものは除く)
     * @param afterId: number
     * @param limit: number
     * @return Promise<SeriesBackfillCandidateRow[]>
     */
    public async findForSeriesBackfill(
        afterId: number,
        limit: number,
        filter: SeriesBackfillFilter = {},
    ): Promise<SeriesBackfillCandidateRow[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = this.createSeriesBackfillQuery(connection, afterId, filter)
            .select(['recorded.id', 'recorded.name', 'recorded.channelId', 'recorded.startAt'])
            .orderBy('recorded.id', 'ASC')
            .limit(limit);

        const rows = await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });

        return rows.map(row => ({
            id: row.id,
            name: row.name,
            channelId: row.channelId,
            startAt: row.startAt,
        }));
    }

    /**
     * シリーズ化バックフィルの残件数を取得する
     * @param afterId: number
     * @param filter: SeriesBackfillFilter
     * @return Promise<number>
     */
    public async countForSeriesBackfill(afterId: number, filter: SeriesBackfillFilter = {}): Promise<number> {
        const connection = await this.op.getConnection();
        const queryBuilder = this.createSeriesBackfillQuery(connection, afterId, filter);

        return await this.promieRetry.run(() => {
            return queryBuilder.getCount();
        });
    }

    /**
     * 直近 (id 降順) の録画 count 件のうち最も小さい id を返す
     * @param count: number
     * @return Promise<number> 対象が無い場合は 0
     */
    public async findSeriesBackfillFloorId(count: number): Promise<number> {
        if (count <= 0) {
            return 0;
        }

        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .select(['recorded.id'])
            .where('recorded.isRecording = :isRecording', { isRecording: false })
            .orderBy('recorded.id', 'DESC')
            .limit(count);

        const rows = await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });

        return rows.length === 0 ? 0 : rows[rows.length - 1].id;
    }

    /**
     * シリーズ化バックフィルの対象を絞り込んだクエリビルダを作る
     * @param connection: DataSource
     * @param afterId: number
     * @param filter: SeriesBackfillFilter
     * @return SelectQueryBuilder<Recorded>
     */
    private createSeriesBackfillQuery(
        connection: DataSource,
        afterId: number,
        filter: SeriesBackfillFilter,
    ): SelectQueryBuilder<Recorded> {
        const queryBuilder = connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .where('recorded.id > :afterId', { afterId })
            .andWhere('recorded.isRecording = :isRecording', { isRecording: false });

        if (typeof filter.minId === 'number' && filter.minId > 0) {
            queryBuilder.andWhere('recorded.id >= :minId', { minId: filter.minId });
        }

        if (filter.onlyUnlinked === true) {
            // まだシリーズへリンクされていない録画だけに絞る (DB 側で弾くことで走査自体を減らす)
            queryBuilder.andWhere(qb => {
                const sub = qb.subQuery().select('link.recordedId').from(RecordedSeriesLink, 'link').getQuery();

                return `recorded.id NOT IN ${sub}`;
            });
        }

        return queryBuilder;
    }
}
