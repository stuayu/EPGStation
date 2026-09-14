import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IRecordedDB from '../../db/IRecordedDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IStreamApiModel from '../stream/IStreamApiModel';
import IVideoApiModel from './IVideoApiModel';
import IOfflineVideoApiModel, { OfflineVideoStreamResult } from './IOfflineVideoApiModel';

class OfflineStreamSemaphore {
    private available: number;
    private readonly waiters: Array<() => void> = [];

    public constructor(limit: number = 3) {
        this.available = limit;
    }

    public async acquire(): Promise<() => void> {
        if (this.available === 0) {
            await new Promise<void>(resolve => this.waiters.push(resolve));
        }
        this.available -= 1;
        let released = false;
        return () => {
            if (released === true) return;
            released = true;
            this.available += 1;
            this.waiters.shift()?.();
        };
    }

    public getAvailable(): number {
        return this.available;
    }
}

@injectable()
export default class OfflineVideoApiModel implements IOfflineVideoApiModel {
    public static readonly MAX_CONCURRENT_STREAMS = 3;
    private readonly semaphore = new OfflineStreamSemaphore(OfflineVideoApiModel.MAX_CONCURRENT_STREAMS);

    public constructor(
        @inject('IStreamApiModel') private readonly streamApi: IStreamApiModel,
        @inject('IVideoFileDB') private readonly videoFileDB: IVideoFileDB,
        @inject('IRecordedDB') private readonly recordedDB: IRecordedDB,
        @inject('IVideoApiModel') private readonly videoApi: IVideoApiModel,
    ) {}

    /**
     * 録画済みファイルを先頭から最後までエンコードするオフライン保存用ストリームを開始する
     * @param videoFileId: apid.VideoFileId
     * @param profile: 録画 HLS の配信プロファイル id
     * @param audioTrack: 保存する音声トラック
     * @return Promise<OfflineVideoStreamResult>
     */
    public async startOfflineStream(
        videoFileId: apid.VideoFileId,
        profile: string,
        audioTrack: apid.AudioTrackSpecifier = 'all',
    ): Promise<OfflineVideoStreamResult> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) throw new Error('VideoFileIsUndefined');

        const recorded = await this.recordedDB.findId(video.recordedId);
        if (recorded === null) throw new Error('RecordedIsUndefined');
        if (recorded.isRecording === true) throw new Error('RecordingVideoCannotBeSavedOffline');
        if (profile === 'original' || profile === 'original-mpeg2')
            throw new Error('OfflineOriginalProfileUnsupported');

        const release = await this.semaphore.acquire();
        let streamId: apid.StreamId | null = null;
        let cleaned = false;
        try {
            const result = await this.streamApi.startRecordedOfflineHLSStream({
                videoFileId,
                playPosition: 0,
                profile,
                audioTrack,
            });
            streamId = result.streamId;
            const metadata: apid.OfflineVideoStreamMetadata = {
                videoFileId,
                fileSize: Number(video.size),
                duration: video.duration ?? recorded.duration,
                profile,
                formatVersion: 2,
            };

            return {
                streamId,
                stream: result.stream,
                metadata,
                cleanup: async (): Promise<void> => {
                    if (cleaned === true) return;
                    cleaned = true;
                    try {
                        if (streamId !== null) await this.streamApi.stop(streamId, true);
                    } finally {
                        release();
                    }
                },
            };
        } catch (err) {
            if (streamId !== null) await this.streamApi.stop(streamId, true).catch(() => undefined);
            release();
            throw err;
        }
    }

    /** テスト用に現在の空き枠を返す */
    public getAvailableSlotCount(): number {
        return this.semaphore.getAvailable();
    }

    /** MPEG-2 Original の Range 配信対象ファイルを解決する。 */
    public async getOriginalMpeg2FilePath(videoFileId: apid.VideoFileId): Promise<{ path: string } | null> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) throw new Error('VideoFileIsUndefined');
        const recorded = await this.recordedDB.findId(video.recordedId);
        if (recorded === null) throw new Error('RecordedIsUndefined');
        if (recorded.isRecording === true) throw new Error('RecordingVideoCannotBeSavedOffline');
        return await this.videoApi.getOriginalMpeg2FilePath(videoFileId);
    }
}
