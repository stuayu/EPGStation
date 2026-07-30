import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import VideoFile from '../../db/entities/VideoFile';
import VideoFileTsInfo from '../../db/entities/VideoFileTsInfo';
import IPromiseRetry from '../IPromiseRetry';
import IDBOperator from './IDBOperator';
import IVideoFileTsInfoDB from './IVideoFileTsInfoDB';

@injectable()
export default class VideoFileTsInfoDB implements IVideoFileTsInfoDB {
    // TS 解析の対象にするファイル種別 (エンコード済みファイルには PSI/SI が無い)
    private static readonly ANALYZABLE_TYPE = 'ts';

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

    /**
     * まだ TS 解析していない TS ファイルを取得する
     * @param limit: number 最大取得件数
     * @return Promise<VideoFile[]>
     */
    public async findWithoutTsInfo(limit: number): Promise<VideoFile[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(VideoFile)
            .createQueryBuilder('video_file')
            .where(qb => {
                const sub = qb.subQuery().select('ts_info.videoFileId').from(VideoFileTsInfo, 'ts_info').getQuery();

                return `video_file.id NOT IN ${sub}`;
            })
            .andWhere('video_file.type = :type', { type: VideoFileTsInfoDB.ANALYZABLE_TYPE })
            .orderBy('video_file.id', 'DESC')
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
            .andWhere('video_file.type = :type', { type: VideoFileTsInfoDB.ANALYZABLE_TYPE });

        return await this.promieRetry.run(() => {
            return queryBuilder.getCount();
        });
    }

    /**
     * TS 解析の対象になりうるファイル (TS ファイル) の総件数を返す
     * @return Promise<number>
     */
    public async countAnalyzableVideoFiles(): Promise<number> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(VideoFile)
            .createQueryBuilder('video_file')
            .where('video_file.type = :type', { type: VideoFileTsInfoDB.ANALYZABLE_TYPE });

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
