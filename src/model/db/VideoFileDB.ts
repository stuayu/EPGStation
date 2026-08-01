import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import VideoFile from '../../db/entities/VideoFile';
import IPromiseRetry from '../IPromiseRetry';
import IDBOperator from './IDBOperator';
import IVideoFileDB, { UpdateFilePathOption, VideoFileMetadata } from './IVideoFileDB';

@injectable()
export default class VideoFileDB implements IVideoFileDB {
    private op: IDBOperator;
    private promieRetry: IPromiseRetry;

    constructor(@inject('IDBOperator') op: IDBOperator, @inject('IPromiseRetry') promieRetry: IPromiseRetry) {
        this.op = op;
        this.promieRetry = promieRetry;
    }

    /**
     * バックアップから復元
     * @param items: VideoFile[]
     * @return Promise<void>
     */
    public async restore(items: VideoFile[]): Promise<void> {
        // get queryRunner
        const connection = await this.op.getConnection();
        const queryRunner = connection.createQueryRunner();

        // start transaction
        await queryRunner.startTransaction();

        let hasError = false;
        try {
            // 削除
            await queryRunner.manager.createQueryBuilder().delete().from(VideoFile).execute();

            // 挿入処理
            for (const item of items) {
                await queryRunner.manager.insert(VideoFile, item);
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
     * ビデオファイル情報を 1 件挿入
     * @param videoFile: VideoFile
     * @return inserted id
     */
    public async insertOnce(videoFile: VideoFile): Promise<apid.VideoFileId> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().insert().into(VideoFile).values(videoFile);

        const insertedResult = await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });

        return insertedResult.identifiers[0].id;
    }

    /**
     * ファイルパス変更
     * @param option: UpdateFilePathOption
     * @return Promise<void>
     */
    public async updateFilePath(option: UpdateFilePathOption): Promise<void> {
        const videoFile = await this.findId(option.videoFileId);
        if (videoFile === null) {
            throw new Error('VideoFileIsNull');
        }

        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(VideoFile)
            .set({
                parentDirectoryName: option.parentDirectoryName,
                filePath: option.filePath,
            })
            .where({ id: option.videoFileId });

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * ファイルサイズ更新
     * @param videoFileId: video file id
     * @param size: file size
     * @return Promise<void>
     */
    public async updateSize(videoFileId: apid.VideoFileId, size: number): Promise<void> {
        const videoFile = await this.findId(videoFileId);
        if (videoFile === null) {
            throw new Error('VideoFileIsNull');
        }

        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(VideoFile)
            .set({
                size: size,
            })
            .where({ id: videoFileId });

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * ffprobe で実測した動画メタデータを更新する
     * @param videoFileId: apid.VideoFileId
     * @param metadata: VideoFileMetadata 実測値
     * @return Promise<void>
     */
    public async updateMetadata(videoFileId: apid.VideoFileId, metadata: VideoFileMetadata): Promise<void> {
        const connection = await this.op.getConnection();
        const values: Record<string, unknown> = {
            duration: metadata.duration,
            startTime: metadata.startTime,
            videoCodec: metadata.videoCodec,
            audioCodec: metadata.audioCodec,
            width: metadata.width,
            height: metadata.height,
            bitRate: metadata.bitRate,
            analyzedAt: new Date().getTime(),
        };

        // ffprobe が返したファイルサイズも分かるのでついでに合わせておく
        if (typeof metadata.size === 'number' && metadata.size > 0) {
            values.size = metadata.size;
        }

        const queryBuilder = connection.createQueryBuilder().update(VideoFile).set(values).where({ id: videoFileId });

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 録画ファイルの先頭に対応する実時刻を更新する
     * @param videoFileId: apid.VideoFileId
     * @param startAt: number 録画開始時刻 (UNIX 時刻・ミリ秒)
     * @return Promise<void>
     */
    public async updateStartAt(videoFileId: apid.VideoFileId, startAt: number): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(VideoFile)
            .set({
                startAt: startAt,
            })
            .where({ id: videoFileId });

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定したビデオファイル情報を 1 件削除
     * @param VideoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async deleteOnce(VideoFileId: apid.VideoFileId): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().delete().from(VideoFile).where({
            id: VideoFileId,
        });

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定した recordedId のビデオファイル情報を削除する
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async deleteRecordedId(recordedId: apid.RecordedId): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().delete().from(VideoFile).where({
            recordedId: recordedId,
        });

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * id を指定して取得する
     * @param videoFileId: video file id
     * @return Promise<VideoFile | null>
     */
    public async findId(videoFileId: apid.VideoFileId): Promise<VideoFile | null> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection.getRepository(VideoFile).createQueryBuilder().where({ id: videoFileId });

        const result = await this.promieRetry.run(() => {
            return queryBuilder.getOne();
        });

        return typeof result === 'undefined' ? null : result;
    }

    /**
     * 全てのビデオファイルを取得する
     */
    public async findAll(): Promise<VideoFile[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection.getRepository(VideoFile).createQueryBuilder();

        return await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });
    }

    /**
     * まだ ffprobe で解析していないビデオファイルを取得する
     * @param limit: number 最大取得件数
     * @return Promise<VideoFile[]>
     */
    public async findWithoutMetadata(limit: number, offset: number = 0): Promise<VideoFile[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(VideoFile)
            .createQueryBuilder('video_file')
            .where('video_file.analyzedAt IS NULL')
            .orderBy('video_file.id', 'DESC')
            .offset(offset)
            .limit(limit);

        return await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });
    }

    /**
     * 解析済みかどうかに関わらず、ビデオファイルを id 昇順で取得する。
     * 全件を強制的に再解析する用途 (offset によるページング前提)
     * @param limit: number 最大取得件数
     * @param offset: number 開始位置
     * @return Promise<VideoFile[]>
     */
    /**
     * 指定した録画に紐づくビデオファイルを取得する
     * @param recordedId: apid.RecordedId
     * @return Promise<VideoFile[]>
     */
    public async findRecordedId(recordedId: apid.RecordedId): Promise<VideoFile[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(VideoFile)
            .createQueryBuilder('video_file')
            .where({ recordedId: recordedId })
            .orderBy('video_file.id', 'ASC');

        return await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });
    }

    public async findAllPaged(limit: number, offset: number): Promise<VideoFile[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(VideoFile)
            .createQueryBuilder('video_file')
            .orderBy('video_file.id', 'ASC')
            .offset(offset)
            .limit(limit);

        return await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });
    }

    /**
     * 登録されているビデオファイルの総件数を返す
     * @return Promise<number>
     */
    public async countAll(): Promise<number> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection.getRepository(VideoFile).createQueryBuilder('video_file');

        return await this.promieRetry.run(() => {
            return queryBuilder.getCount();
        });
    }

    /**
     * まだ ffprobe で解析していないビデオファイルの件数を返す
     * @return Promise<number>
     */
    public async countWithoutMetadata(): Promise<number> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(VideoFile)
            .createQueryBuilder('video_file')
            .where('video_file.analyzedAt IS NULL');

        return await this.promieRetry.run(() => {
            return queryBuilder.getCount();
        });
    }
}
