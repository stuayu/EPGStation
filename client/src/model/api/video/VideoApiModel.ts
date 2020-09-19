import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IVideoApiModel from './IVideoApiModel';

@injectable()
export default class VideoApiModel implements IVideoApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    /**
     * ビデオファイルの削除
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async delete(videoFileId: apid.VideoFileId): Promise<void> {
        await this.repository.delete(`/videos/${videoFileId}`);
    }

    /**
     * 指定したビデオファイルの長さを取得する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<number> 動画の長さ(秒)
     */
    public async getDuration(videoFileId: apid.VideoFileId): Promise<number> {
        const result = await this.repository.get(`/videos/${videoFileId}/duration`);

        return (<any>result.data).duration;
    }

    /**
     * kodi にビデオリンクを送信する
     * @param hostName: kodi host name
     * @param videoFileId: apid.VideoFileId)
     * @return Promise<void>
     */
    public async sendToKodi(hostName: string, videoFileId: apid.VideoFileId): Promise<void> {
        await this.repository.post(`/videos/${videoFileId}/kodi`, {
            kodiName: hostName,
        });
    }
}
