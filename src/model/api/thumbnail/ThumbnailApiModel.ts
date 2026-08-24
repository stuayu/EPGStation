import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import IThumbnailDB from '../../db/IThumbnailDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import IIPCClient from '../../ipc/IIPCClient';
import IThumbnailApiModel from './IThumbnailApiModel';

@injectable()
export default class ThumbnailApiModel implements IThumbnailApiModel {
    private ipc: IIPCClient;
    private thumbnailDB: IThumbnailDB;
    private config: IConfigFile;
    private videoFileDB: IVideoFileDB;

    constructor(
        @inject('IIPCClient') ipc: IIPCClient,
        @inject('IThumbnailDB') thumbnailDB: IThumbnailDB,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
    ) {
        this.ipc = ipc;
        this.thumbnailDB = thumbnailDB;
        this.config = configuration.getConfig();
        this.videoFileDB = videoFileDB;
    }

    /**
     * 指定した id のサムネイルファイルパスを返す
     * @param thumbnailId: apid.ThumbnailId
     * @return Promise<string | null>
     */
    public async getIdFilePath(thumbnailId: apid.ThumbnailId): Promise<string | null> {
        const thumbnail = await this.thumbnailDB.findId(thumbnailId);
        if (thumbnail === null) {
            return null;
        }

        return path.join(this.config.thumbnailStorageRoot || this.config.thumbnail, thumbnail.filePath);
    }

    /**
     * サムネイルの再生成を行う
     * @return Promise<void>
     */
    public regenerate(): Promise<void> {
        return this.ipc.thumbnail.regenerate();
    }

    /** 指定録画のサムネイル再生成を Operator へ依頼する。 */
    public regenerateRecorded(recordedId: apid.RecordedId, profile?: 'fast' | 'balanced' | 'quality'): Promise<void> {
        return this.ipc.thumbnail.regenerateRecorded(recordedId, profile);
    }

    /**
     * ファイルのクリーンアップ
     */
    public async fileCleanup(): Promise<void> {
        await this.ipc.thumbnail.fileCleanup();
    }

    /**
     * 指定したビデオファイルでサムネイルを追加させる
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async add(videoFileId: apid.VideoFileId): Promise<void> {
        const videoFile = await this.videoFileDB.findId(videoFileId);
        if (videoFile === null) throw new Error('VideoFileIsNotFound');
        await this.ipc.thumbnail.add(videoFile.recordedId);
    }

    /**
     * 指定した id サムネイルを削除
     * @param thumbnailId: apid.ThumbnailId
     * @return Promise<void>
     */
    public async delete(thumbnailId: apid.ThumbnailId): Promise<void> {
        await this.ipc.thumbnail.delete(thumbnailId);
    }
}
