import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IStreamApiModel from '../../api/streams/IStreamApiModel';
import ILiveHLSVideoState from './ILiveHLSVideoState';

@injectable()
class LiveHLSVideoState implements ILiveHLSVideoState {
    private streamApiModel: IStreamApiModel;
    private streamId: apid.StreamId | null = null;
    private streamIds = new Set<apid.StreamId>();
    private keepTimerId: ReturnType<typeof setTimeout> | undefined;

    constructor(@inject('IStreamApiModel') streamApiModel: IStreamApiModel) {
        this.streamApiModel = streamApiModel;
    }

    /**
     * ストリーム開始
     * @param channelId: apid.ChannelId
     * @param mode: number
     * @param audioTrack?: apid.AudioTrackSpecifier 再生する音声トラック (省略時は主音声)
     * @return Promise<void>
     */
    public async start(channelId: apid.ChannelId, mode: number, audioTrack?: apid.AudioTrackSpecifier): Promise<void> {
        const streamId = await this.streamApiModel.startLiveHLS(channelId, mode, audioTrack);
        this.streamId = streamId;
        this.streamIds.add(streamId);

        // ストリームを保持し続ける
        if (typeof this.keepTimerId !== 'undefined') clearInterval(this.keepTimerId);
        this.keepTimerId = setInterval(async () => {
            if (this.streamId === null) {
                return;
            }

            // ストリームを作り直した直後は古い streamId が 404 になる。
            // keep はベストエフォートなので握り潰す (未処理の Promise 拒否にしない)
            await this.streamApiModel.keep(this.streamId).catch(err => {
                console.error(err);
            });
        }, LiveHLSVideoState.KEEP_INTERVAL * 1000);
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

        let firstError: unknown = null;
        for (const streamId of this.streamIds) {
            try {
                await this.streamApiModel.stop(streamId);
            } catch (err) {
                firstError ??= err;
            }
        }
        this.streamIds.clear();
        this.streamId = null;
        if (firstError !== null) throw firstError;
    }

    /** 切替に失敗した現在のストリームだけを停止し、切替前のストリームへ戻す。 */
    public async stopCurrentStream(): Promise<void> {
        const current = this.streamId;
        if (current === null) return;

        let firstError: unknown = null;
        try {
            await this.streamApiModel.stop(current);
            this.streamIds.delete(current);
        } catch (err) {
            firstError = err;
        }

        const previous = [...this.streamIds].at(-1) ?? null;
        this.streamId = previous;
        if (firstError !== null) throw firstError;
    }

    /** 新しい配信の再生開始後に、切替前のライブ配信を停止する。 */
    public async stopPreviousStream(): Promise<void> {
        const current = this.streamId;
        let firstError: unknown = null;
        for (const streamId of [...this.streamIds]) {
            if (streamId === current) continue;
            try {
                await this.streamApiModel.stop(streamId);
                this.streamIds.delete(streamId);
            } catch (err) {
                firstError ??= err;
            }
        }
        if (firstError !== null) throw firstError;
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

namespace LiveHLSVideoState {
    export const KEEP_INTERVAL = 10;
}

export default LiveHLSVideoState;
