<template>
    <div ref="container" class="dplayer-wrap"></div>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IRecordedHLSStreamingVideoState from '@/model/state/recorded/streaming/IRecordedHLSStreamingVideoState';
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import DPlayerUtil from '@/util/DPlayerUtil';
import StreamQualityUtil from '@/util/StreamQualityUtil';
import Util from '@/util/Util';
import { DPlayerType } from 'dplayer';
import { Component, Prop, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../api';

@Component({})
class RecordedHLSStreamingVideo extends BaseVideo {
    @Prop({ required: true })
    public recordedId!: apid.RecordedId;

    @Prop({ required: true })
    public mode!: number;

    @Prop({ required: true })
    public videoFileId!: apid.VideoFileId;

    @Prop({ default: null })
    public jikkyoChannelId!: string | null;

    @Prop({ default: null })
    public jikkyoStartAt!: number | null;

    @Prop({ default: null })
    public jikkyoEndAt!: number | null;

    protected videoState = container.get<IRecordedHLSStreamingVideoState>('IRecordedHLSStreamingVideoState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async (): Promise<void> => {
        await this.updateVideoInfo();
    }).bind(this);
    private basePlayPosition: number = 0;
    private dummyPlayPosition: number | null = null; // setCurrentTime が呼ばれている間に再生位置として返すダミー値
    private pauseStateBeforeCurrentTime: boolean = false; // setCurrentTime が処理終了時に再生状態を復元するための値
    private lastUpdatePauseState: number = 0; // 最後に pauseStateBeforeCurrentTime を更新した時間
    private updateDurationTimerId: ReturnType<typeof setTimeout> | undefined; // 録画中の番組の動画長を更新するためのタイマー
    private setCurrentTimeTimerId: ReturnType<typeof setTimeout> | undefined; // setCurrentTime を大量に呼び出さないようにするためのタイマー
    private lastSeekTime: number = 0; // setCurrentTime 実行中に setCurrentTime が重ねて実行されたか確認するための変数
    private qualityNames: string[] = []; // config の hls 視聴設定名一覧
    private currentMode: number = 0; // 再生中の視聴設定 (画質切替で更新される)
    private videoApiModel: IVideoApiModel = container.get<IVideoApiModel>('IVideoApiModel');
    private audioTracks: apid.VideoAudioTrack[] = []; // 選択できる音声トラック
    private currentAudioTrack: apid.AudioTrackSpecifier = 'main'; // 再生中の音声トラック

    /**
     * 録画再生時のニコニコ実況過去ログ取得情報を返す
     */
    protected getJikkyoKakologOption(): { jikkyoChannelId: string; startAt: number; endAt: number } | null {
        if (this.jikkyoChannelId === null || this.jikkyoStartAt === null || this.jikkyoEndAt === null) {
            return null;
        }
        return {
            jikkyoChannelId: this.jikkyoChannelId,
            startAt: this.jikkyoStartAt,
            endAt: this.jikkyoEndAt,
        };
    }

    public created(): void {
        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    public mounted(): void {
        this.containerElement = this.$refs.container as HTMLElement;

        this.$nextTick(async () => {
            await this.videoState.clear();
            await this.updateVideoInfo();
            await this.fetchVideoFileSizeForDataBroadcasting(this.videoFileId);

            // 画質切替用に視聴設定一覧を取得する
            const videoFileType = this.videoState.getVideoFileType(this.videoFileId);
            this.qualityNames = videoFileType === null ? [] : StreamQualityUtil.getRecordedModeNames(videoFileType, 'hls');
            this.currentMode = StreamQualityUtil.normalizeMode(this.qualityNames, this.mode);

            // 録画中の場合は duration が変化するので定期的に timeupdate を発行する
            if (this.videoState.isRecording() === true) {
                this.updateDurationTimerId = setInterval(() => {
                    this.onTimeupdate();

                    // 録画中でなくなったらタイマーを止める
                    if (this.videoState.isRecording() === false) {
                        clearInterval(this.updateDurationTimerId);
                    }
                }, 1000);
            }

            // チャプター・音声トラックを先に取得しておく (DPlayer 生成時に必要)
            await this.fetchChaptersAndAudioTracks();

            // HLS stream 開始
            await this.videoState
                .start(this.videoFileId, this.basePlayPosition, this.currentMode, this.currentAudioTrack)
                .catch(err => {
                    this.snackbarState.open({
                        color: 'error',
                        text: 'ストリーム開始に失敗',
                    });
                });

            // ストリームが有効になるまで待つ
            try {
                await this.waitForEnabled();
            } catch (err) {
                console.error(err);
                this.snackbarState.open({
                    color: 'error',
                    text: 'ストリーム開始に失敗',
                });

                return;
            }

            this.initVideoSetting();
        });
    }

    /**
     * チャプターと音声トラックを取得する
     * どちらも取得に失敗しても再生自体は続けられるため、エラーは握りつぶしてログに残すだけにする
     * @return Promise<void>
     */
    private async fetchChaptersAndAudioTracks(): Promise<void> {
        try {
            this.setChapters(await this.videoApiModel.getChapters(this.videoFileId));
        } catch (err) {
            console.error(err);
        }

        try {
            this.audioTracks = await this.videoApiModel.getAudioTracks(this.videoFileId);
        } catch (err) {
            console.error(err);
            this.audioTracks = [];
        }
    }

    /**
     * ストリームが有効化になるまで待つ
     * @return Promise<void>
     */
    private waitForEnabled(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.videoState.getStreamId() === null) {
                reject(new Error('StreamIdIsNull'));

                return;
            }

            // ストリームが有効になるまで待つ
            let count = 0;
            const checkEnabledTimerId = setInterval(async () => {
                count++;
                if ((await this.videoState.isEnabled()) === true) {
                    clearInterval(checkEnabledTimerId);
                    resolve();

                    return;
                }

                if (count >= RecordedHLSStreamingVideo.WAIT_ENABLED_LIMIT) {
                    clearInterval(checkEnabledTimerId);
                    reject(new Error('StreamIsNotEnabled'));
                }
            }, 1000);
        });
    }

    /**
     * socket.io での状態更新通知時処理
     * @return Promise<void>
     */
    private async updateVideoInfo(): Promise<void> {
        await this.videoState.fetchInfo(this.recordedId, this.videoFileId);
        if (this.videoState.isRecording() === false) {
            clearInterval(this.updateDurationTimerId);
        }
    }

    public async beforeUnmount(): Promise<void> {
        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);

        clearInterval(this.updateDurationTimerId);
        clearTimeout(this.setCurrentTimeTimerId);

        super.beforeUnmount();

        await this.videoState.stop().catch(err => {
            this.snackbarState.open({
                color: 'error',
                text: 'ストリーム停止に失敗',
            });
        });
    }

    /**
     * video 再生初期設定
     */
    protected initVideoSetting(): void {
        if (this.containerElement === null) {
            return;
        }

        const streamId = this.videoState.getStreamId();
        if (streamId === null) {
            this.snackbarState.open({
                color: 'error',
                text: 'ストリーム id 取得に失敗',
            });
            throw new Error('StreamIdIsNull');
        }

        DPlayerUtil.setupGlobals();

        const videoSrc = `./streamfiles/stream${streamId}.m3u8`;

        if (this.dp === null) {
            // 初回生成
            // プレイヤー上から画質 (エンコード設定) を切り替えられるよう quality リストを生成する
            const qualities = StreamQualityUtil.createQualityList(this.qualityNames, videoSrc, 'hls');

            const options: DPlayerType.Options = {
                container: this.containerElement,
                autoplay: true,
                live: false,
                hotkey: true,
                video:
                    qualities.length > 0
                        ? ({
                              quality: qualities,
                              defaultQuality: this.currentMode,
                          } as DPlayerType.Options['video'])
                        : {
                              url: videoSrc,
                              type: 'hls',
                          },
                subtitle: {
                    type: 'aribb24',
                },
                pluginOptions: {
                    // hls.js 使用時 (Safari 以外) の設定
                    // サーバーは録画済み HLS も LL-HLS (#EXT-X-PART) で配信する。
                    // lowLatencyMode を有効にするとパート単位で取得するため、再生開始・
                    // シーク後の待ちが 1 セグメント分から 1 パート分 (既定 0.5 秒) に縮む。
                    //
                    // ただし LatencyController の追いつき再生 (playbackRate の書き換え) は
                    // 配信ジッタで常時発火して再生速度の微振動を起こすため無効にする
                    // (maxLiveSyncPlaybackRate: 1)。
                    // なお lowLatencyMode は hls.js の既定値が true なので、
                    // ここでの明示は挙動を設定として固定するためのもの
                    hls: {
                        lowLatencyMode: true,
                        maxLiveSyncPlaybackRate: 1,
                        // 巻き戻し操作に応えるため、再生済み範囲は長めに保持する
                        backBufferLength: 90,
                        fragLoadingMaxRetry: 2,
                        fragLoadingRetryDelay: 200,
                        manifestLoadingMaxRetry: 2,
                        manifestLoadingRetryDelay: 200,
                    } as any,
                    aribb24: DPlayerUtil.createAribb24Options(),
                },
            };

            // チャプターをシークバー上のマーカーとして表示する
            this.applyChapterHighlights(options, this.getDuration());

            this.createPlayer(options);
            this.setupAudioTrackSwitchForRecorded();

            // 画質切替時は現在の再生位置からストリームを作り直してから url を差し替える
            this.setupQualitySwitch({
                resolveUrl: mode => this.restartStream(mode),
                resetCurrentTime: true,
                onSwitched: mode => {
                    this.currentMode = mode;
                },
            });
        } else {
            // seek によるストリーム再生成
            this.dp.switchVideo({ url: videoSrc, type: 'hls' }, false, false);
        }

        // hls.js のバッファリング位置の関係で再生開始位置がずれることがあるため 0 に固定する
        if (this.dp !== null) {
            this.dp.on(
                'canplay',
                () => {
                    if (this.dp !== null) {
                        this.dp.video.currentTime = 0;
                        this.dp.play();
                    }
                },
                true,
            );
        }
    }

    /**
     * 指定した mode で現在の再生位置からストリームを作り直し、新しい m3u8 の url を返す
     * @param mode: number
     * @return Promise<string> m3u8 の url
     */
    private async restartStream(mode: number): Promise<string> {
        const playPosition = this.getCurrentTime();

        await this.videoState.stop();
        this.basePlayPosition = playPosition;
        await this.videoState.start(this.videoFileId, this.basePlayPosition, mode, this.currentAudioTrack);
        await this.waitForEnabled();

        const streamId = this.videoState.getStreamId();
        if (streamId === null) {
            throw new Error('StreamIdIsNull');
        }

        return `./streamfiles/stream${streamId}.m3u8`;
    }

    /**
     * DPlayer の設定 > 音声パネルへ音声トラック切替を組み込む
     * HLS 配信では音声を切り替えるとサーバー側のストリームを作り直す必要があるため、
     * 画質切替と同じく「現在の再生位置からストリームを再生成して url を差し替える」形にする
     */
    private setupAudioTrackSwitchForRecorded(): void {
        this.setupAudioTrackSwitch({
            tracks: this.audioTracks,
            current: this.currentAudioTrack,
            onSelect: async track => {
                const playPosition = this.getCurrentTime();
                await this.videoState.stop();
                this.basePlayPosition = playPosition;
                await this.videoState.start(this.videoFileId, this.basePlayPosition, this.currentMode, track);
                await this.waitForEnabled();
                this.currentAudioTrack = track;
                this.initVideoSetting();
            },
        });
    }

    /**
     * DPlayer のシークバーを動画全体の時間軸で扱う
     * @return boolean
     */
    protected isEnabledVirtualTimeline(): boolean {
        return true;
    }

    /**
     * データ放送 (BML) の接続パラメータ
     */
    public getDataBroadcastingParam() {
        return this.buildRecordedDataBroadcastingParam(this.videoFileId);
    }

    /**
     * 動画の長さを返す (秒)
     * @return number
     */
    public getDuration(): number {
        return this.videoState.getDuration();
    }

    /**
     * エンコード済みの位置を動画全体の時間軸で返す (秒)
     * HLS はプレイリストの長さがエンコード済みの長さになる
     * @return number
     */
    public getEncodedTime(): number {
        const streamDuration = super.getDuration();
        const encoded = Math.max(isFinite(streamDuration) === true ? streamDuration : 0, super.getEncodedTime());

        return Math.min(this.basePlayPosition + encoded, this.getDuration());
    }

    /**
     * 動画の現在再生位置を返す (秒)
     * @return number
     */
    public getCurrentTime(): number {
        if (this.dummyPlayPosition !== null) {
            return this.dummyPlayPosition;
        }

        return this.dp === null ? 0 : this.basePlayPosition + super.getCurrentTime();
    }

    /**
     * 再生位置設定
     * @param time: number (秒)
     */
    public setCurrentTime(time: number): void {
        if (this.dp === null) {
            return;
        }

        // エンコード済み範囲か
        if (time >= this.basePlayPosition && time <= this.basePlayPosition + super.getDuration()) {
            super.setCurrentTime(time - this.basePlayPosition);
            this.onTimeupdate();

            return;
        }

        const now = new Date().getTime();
        if (this.dummyPlayPosition === null && now - this.lastUpdatePauseState > 1000) {
            this.pauseStateBeforeCurrentTime = this.paused();
            this.lastUpdatePauseState = now;
        }
        this.dummyPlayPosition = time;
        this.onTimeupdate();

        clearTimeout(this.setCurrentTimeTimerId);
        this.setCurrentTimeTimerId = setTimeout(async () => {
            if (this.dp === null) {
                return;
            }

            const playbackRate = this.dp.video.playbackRate;

            const needsShowSubtitle = this.isShowingSubtitle();
            this.disabledSubtitle();
            this.basePlayPosition = time;
            this.onWaiting();
            this.onPause();

            const beforeStartStream = new Date().getTime();
            this.lastSeekTime = beforeStartStream;

            try {
                if (this.lastSeekTime !== beforeStartStream) {
                    return;
                }
                await this.videoState.stop();
                if (this.lastSeekTime !== beforeStartStream) {
                    return;
                }
                await this.videoState.start(this.videoFileId, this.basePlayPosition, this.currentMode);
                if (this.lastSeekTime !== beforeStartStream) {
                    return;
                }
                await this.waitForEnabled();
                if (this.lastSeekTime !== beforeStartStream) {
                    return;
                }
                this.initVideoSetting();
                if (needsShowSubtitle === true) {
                    this.showSubtitle();
                }
            } catch (err) {
                console.error(err);
                await this.videoState.stop();
                this.setCurrentTime(time);

                return;
            }

            await Util.sleep(500);
            if (this.dp !== null) {
                this.dp.video.playbackRate = playbackRate;
            }
            this.dummyPlayPosition = null;
        }, 200);
    }
}

namespace RecordedHLSStreamingVideo {
    export const WAIT_ENABLED_LIMIT = 60; // ストリームが有効になるまで待つ最大秒数
}

export default toNative(RecordedHLSStreamingVideo);
</script>
