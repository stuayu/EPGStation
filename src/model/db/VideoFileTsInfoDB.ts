import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import VideoFile from '../../db/entities/VideoFile';
import VideoFileTsInfo from '../../db/entities/VideoFileTsInfo';
import IPromiseRetry from '../IPromiseRetry';
import IDBOperator from './IDBOperator';
import IVideoFileTsInfoDB from './IVideoFileTsInfoDB';

@injectable()
export default class VideoFileTsInfoDB implements IVideoFileTsInfoDB {
    // TS 解析の対象にする拡張子 (これ以外の完全な再マルチプレクスには PSI/SI が無い)。
    // video_file.type ('ts' | 'encoded') はストリーミングパイプラインの選択にも使われており、
    // tsreplace 系 (type: 'encoded' だが出力が .ts のまま PSI/SI を保持) も対象に含めたいため、
    // type ではなく拡張子で判定する (詳細は VideoFileAnalyzeModel.analyzeTsInfo() のコメント参照)
    private static readonly ANALYZABLE_EXTENSION_LIKE = '%.ts';
    // IN 句のバインド変数上限 (SQLite は既定 999) を超えないように分割する単位
    private static readonly LOOKUP_CHUNK_SIZE = 200;

    private op: IDBOperator;
    private promieRetry: IPromiseRetry;

    constructor(@inject('IDBOperator') op: IDBOperator, @inject('IPromiseRetry') promieRetry: IPromiseRetry) {
        this.op = op;
        this.promieRetry = promieRetry;
    }

    /**
     * TS 解析結果を保存する (既にある場合は上書きする)
     * @param info: VideoFileTsInfo
     * @return Promise<void>
     */
    public async upsert(info: VideoFileTsInfo): Promise<void> {
        const connection = await this.op.getConnection();
        const repository = connection.getRepository(VideoFileTsInfo);

        await this.promieRetry.run(async () => {
            const old = await repository.findOne({ where: { videoFileId: info.videoFileId } });
            if (old === null) {
                await repository.insert(info);
            } else {
                await repository.update({ videoFileId: info.videoFileId }, info);
            }
        });
    }

    /**
     * 指定した video file id の TS 解析結果を取得する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<VideoFileTsInfo | null> 未解析の場合は null
     */
    public async findId(videoFileId: apid.VideoFileId): Promise<VideoFileTsInfo | null> {
        const connection = await this.op.getConnection();
        const repository = connection.getRepository(VideoFileTsInfo);

        return await this.promieRetry.run(() => {
            return repository.findOne({ where: { videoFileId: videoFileId } });
        });
    }

    /**
     * 指定した録画に紐づくビデオファイルの TS 解析結果を取得する
     * 複数ある場合は最初に解析されたものを返す
     * @param recordedId: apid.RecordedId
     * @return Promise<VideoFileTsInfo | null>
     */
    public async findRecordedId(recordedId: apid.RecordedId): Promise<VideoFileTsInfo | null> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(VideoFileTsInfo)
            .createQueryBuilder('ts_info')
            .innerJoin(VideoFile, 'video_file', 'video_file.id = ts_info.videoFileId')
            .where('video_file.recordedId = :recordedId', { recordedId: recordedId })
            .orderBy('ts_info.videoFileId', 'ASC');

        return await this.promieRetry.run(() => {
            return queryBuilder.getOne();
        });
    }

    public async findServiceNamesByRecordedIds(recordedIds: apid.RecordedId[]): Promise<Map<apid.RecordedId, string>> {
        const result = new Map<apid.RecordedId, string>();
        if (recordedIds.length === 0) return result;
        const connection = await this.op.getConnection();

        // IN 句のバインド変数上限 (SQLite は既定 999) を超えないよう分割して引く
        for (let i = 0; i < recordedIds.length; i += VideoFileTsInfoDB.LOOKUP_CHUNK_SIZE) {
            const chunk = recordedIds.slice(i, i + VideoFileTsInfoDB.LOOKUP_CHUNK_SIZE);
            const rows = await this.promieRetry.run(() => {
                return (
                    connection
                        .getRepository(VideoFileTsInfo)
                        .createQueryBuilder('ts_info')
                        .innerJoin(VideoFile, 'video_file', 'video_file.id = ts_info.videoFileId')
                        .where('video_file.recordedId IN (:...recordedIds)', { recordedIds: chunk })
                        .andWhere('ts_info.serviceName IS NOT NULL')
                        .select('video_file.recordedId', 'recordedId')
                        .addSelect('ts_info.serviceName', 'serviceName')
                        // 同じ録画に複数のファイルがある場合は先頭 (最初に解析されたもの) を採る
                        .orderBy('ts_info.videoFileId', 'ASC')
                        .getRawMany<{ recordedId: number; serviceName: string | null }>()
                );
            });
            for (const row of rows) {
                const recordedId = Number(row.recordedId);
                const serviceName = (row.serviceName ?? '').trim();
                if (serviceName === '' || result.has(recordedId) === true) continue;
                result.set(recordedId, serviceName);
            }
        }

        return result;
    }

    /**
     * まだ TS 解析していない TS ファイルを取得する
     * @param limit: number 最大取得件数
     * @return Promise<VideoFile[]>
     */
    public async findWithoutTsInfo(limit: number, offset: number = 0): Promise<VideoFile[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(VideoFile)
            .createQueryBuilder('video_file')
            .where(qb => {
                const sub = qb.subQuery().select('ts_info.videoFileId').from(VideoFileTsInfo, 'ts_info').getQuery();

                return `video_file.id NOT IN ${sub}`;
            })
            .andWhere('LOWER(video_file.filePath) LIKE :ext', { ext: VideoFileTsInfoDB.ANALYZABLE_EXTENSION_LIKE })
            .orderBy('video_file.id', 'DESC')
            .offset(offset)
            .limit(limit);

        return await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });
    }

    /**
     * まだ TS 解析していない TS ファイルの件数を返す
     * @return Promise<number>
     */
    public async countWithoutTsInfo(): Promise<number> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(VideoFile)
            .createQueryBuilder('video_file')
            .where(qb => {
                const sub = qb.subQuery().select('ts_info.videoFileId').from(VideoFileTsInfo, 'ts_info').getQuery();

                return `video_file.id NOT IN ${sub}`;
            })
            .andWhere('LOWER(video_file.filePath) LIKE :ext', { ext: VideoFileTsInfoDB.ANALYZABLE_EXTENSION_LIKE });

        return await this.promieRetry.run(() => {
            return queryBuilder.getCount();
        });
    }

    /**
     * TS 解析の対象になりうるファイル (拡張子が .ts のファイル) の総件数を返す
     * @return Promise<number>
     */
    public async countAnalyzableVideoFiles(): Promise<number> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(VideoFile)
            .createQueryBuilder('video_file')
            .where('LOWER(video_file.filePath) LIKE :ext', { ext: VideoFileTsInfoDB.ANALYZABLE_EXTENSION_LIKE });

        return await this.promieRetry.run(() => {
            return queryBuilder.getCount();
        });
    }

    /**
     * TS 解析済みかどうかに関わらず、対象になりうるファイル (拡張子が .ts のファイル) を
     * id 昇順ですべて取得する。解析ロジックの更新後に既存ファイルを強制的に
     * 再解析する用途 (offset によるページング前提)
     * @param limit: number 最大取得件数
     * @param offset: number 開始位置
     * @return Promise<VideoFile[]>
     */
    public async findAllAnalyzable(limit: number, offset: number): Promise<VideoFile[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(VideoFile)
            .createQueryBuilder('video_file')
            .where('LOWER(video_file.filePath) LIKE :ext', { ext: VideoFileTsInfoDB.ANALYZABLE_EXTENSION_LIKE })
            .orderBy('video_file.id', 'ASC')
            .offset(offset)
            .limit(limit);

        return await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });
    }

    /**
     * TS 解析済みの video file id を id 昇順で取得する。
     * 保存済みの解析結果から放送局を反映し直す用途 (ファイルは読まない)
     * @param limit: number 最大取得件数
     * @param offset: number 開始位置
     * @return Promise<apid.VideoFileId[]>
     */
    public async findAnalyzedVideoFileIds(limit: number, offset: number): Promise<apid.VideoFileId[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(VideoFileTsInfo)
            .createQueryBuilder('ts_info')
            .orderBy('ts_info.videoFileId', 'ASC')
            .offset(offset)
            .limit(limit);

        const rows = await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });

        return rows.map(row => row.videoFileId);
    }

    /**
     * TS 解析済みの件数を返す
     * @return Promise<number>
     */
    public async countAnalyzed(): Promise<number> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection.getRepository(VideoFileTsInfo).createQueryBuilder('ts_info');

        return await this.promieRetry.run(() => {
            return queryBuilder.getCount();
        });
    }

    /**
     * 指定した video file id の TS 解析結果を削除する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async deleteVideoFileId(videoFileId: apid.VideoFileId): Promise<void> {
        const connection = await this.op.getConnection();

        await this.promieRetry.run(() => {
            return connection.getRepository(VideoFileTsInfo).delete({ videoFileId: videoFileId });
        });
    }
}
