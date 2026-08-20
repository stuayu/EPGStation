import { inject, injectable } from 'inversify';
import * as apid from '../../../../../../api';
import Util from '../../../../util/Util';
import IStreamApiModel from '../../..//api/streams/IStreamApiModel';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel';
import IVideoApiModel from '../../../api/video/IVideoApiModel';
import IRecordedHLSStreamingVideoState from './IRecordedHLSStreamingVideoState';
import RecordedStreamingVideoState from './RecordedStreamingVideoState';

@injectable()
class RecordedHLSStreamingVideoState extends RecordedStreamingVideoState implements IRecordedHLSStreamingVideoState {
    private streamApiModel: IStreamApiModel;
    private streamId: apid.StreamId | null = null;
    private keepTimerId: ReturnType<typeof setTimeout> | undefined;

    private isStarting: boolean = false;

    constructor(
        @inject('IStreamApiModel') streamApiModel: IStreamApiModel,
        @inject('IVideoApiModel') videoApiModel: IVideoApiModel,
        @inject('IRecordedApiModel') recordedApiModel: IRecordedApiModel,
    ) {
        super(videoApiModel, recordedApiModel);

        this.streamApiModel = streamApiModel;
    }

    /**
     * ストリーム開始
     * @param videoFileId: apid.VideoFileId
     * @param playPosition: number 再生位置
     * @param mode: number
     * @param audioTrack?: apid.AudioTrackSpecifier 再生する音声トラック (省略時は主音声)
     * @return Promise<void>
     */
    public async start(
        videoFileId: apid.VideoFileId,
        playPosition: number,
        mode: number,
        audioTrack?: apid.AudioTrackSpecifier,
    ): Promise<void> {
        if (this.isStarting === true) {
            return;
        }

        if (this.streamId !== null) {
            await this.stop();
        }

        this.isStarting = true;
        try {
            this.streamId = await this.streamApiModel.startRecordedHLS(videoFileId, playPosition, mode, audioTrack);
            this.isStarting = false;
        } catch (err) {
            this.isStarting = false;
            throw err;
        }

        // ストリームを保持し続ける
        this.keepTimerId = setInterval(async () => {
            if (this.streamId === null) {
                return;
            }

            // ストリームを作り直した直後は古い streamId が 404 になる。
            // keep はベストエフォートなので握り潰す (未処理の Promise 拒否にしない)
            await this.streamApiModel.keep(this.streamId).catch(err => {
                console.error(err);
            });
        }, RecordedHLSStreamingVideoState.KEEP_INTERVAL * 1000);

        await Util.sleep(1000);
    }

    /**
     * ストリーム停止
     * @return Promise<void>
     */
    public async stop(): Promise<void> {
        if (typeof this.keepTimerId !== 'undefined') {
            clearInterval(this.keepTimerId);
            this.keepTimerId = undefined;
        }

        if (this.streamId !== null) {
            await this.streamApiModel.stop(this.streamId);
            this.streamId = null;
        }
    }

    /**
     * streamId を返す
     * @return apid.StreamId | null
     */
    public getStreamId(): apid.StreamId | null {
        return this.streamId;
    }

    /**
     * ストリームが有効になったか
     * @return Promise<boolean> true で有効
     */
    public async isEnabled(): Promise<boolean> {
        const info = await this.streamApiModel.getStreamInfo(true);

        for (const item of info.items) {
            if (item.streamId === this.streamId && item.isEnable === true) {
                return true;
            }
        }

        return false;
    }
}

namespace RecordedHLSStreamingVideoState {
    export const KEEP_INTERVAL = 10;
}

export default RecordedHLSStreamingVideoState;
