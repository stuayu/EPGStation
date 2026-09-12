<template>
    <div ref="container" class="dplayer-wrap"></div>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IRecordedStreamingVideoState from '@/model/state/recorded/streaming/IRecordedStreamingVideoState';
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import DPlayerUtil from '@/util/DPlayerUtil';
import StreamQualityUtil from '@/util/StreamQualityUtil';
import Util from '@/util/Util';
import StreamSupportUtil from '@/util/StreamSupportUtil';
import UaUtil from '@/util/UaUtil';
import { DPlayerType } from 'dplayer';
import { Component, Prop, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../api';
import {
    decideMpegTsLifecycle,
    destroyMpegtsBeforeVideoReuse,
} from '../../../../src/util/MpegTsLifecycleUtil';
import { isInitialPlaybackBufferReady } from '../../../../src/util/PlaybackStartBuffer';
import { resolveRecordedJikkyoPlaybackTime } from '../../../../src/util/RecordedJikkyoSync';
import { normalizeStreamPlayPosition } from '../../../../src/util/StreamPlayPosition';

interface VideoSrcInfo {
    videoFileId: apid.VideoFileId;
    streamingType: string;
    mode: number;
    playPosition: number;
    audioTrack?: apid.AudioTrackSpecifier;
}

@Component({})
class RecordedStreamingVideo extends BaseVideo {
    @Prop({ required: true })
    public recordedId!: apid.RecordedId;

    @Prop({ required: true })
    public mode!: number;

    @Prop({ required: true })
    public videoFileId!: apid.VideoFileId;

    @Prop({ required: true })
    public streamingType!: string;

    @Prop({ default: null })
    public jikkyoChannelId!: string | null;

    @Prop({ default: () => [] })
    public playbackProfiles!: apid.PlaybackProfile[];

    @Prop({ default: null })
    public jikkyoStartAt!: number | null;

    @Prop({ default: null })
    public jikkyoEndAt!: number | null;

    private videoState = container.get<IRecordedStreamingVideoState>('IRecordedStreamingVideoState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    // socket.io の通知はメソッドで受ける (クラスフィールドのコールバックだと this が Vue インスタンスにならず、画面へ反映されない)
    public async onUpdateStatus(): Promise<void> {
        await this.updateVideoInfo();
    }
    private basePlayPosition: number = 0;
    private dummyPlayPosition: number | null = null; // setCurrentTime が呼ばれている間に再生位置として返すダミー値
    private pauseStateBeforeCurrentTime: boolean = false; // setCurrentTime が処理終了時に再生状態を復元するための値
    private lastUpdatePauseState: number = 0; // 最後に pauseStateBeforeCurrentTime を更新した時間
    private updateDurationTimerId: ReturnType<typeof setTimeout> | undefined; // 録画中の番組の動画長を更新するためのタイマー
    private setCurrentTimeTimerId: ReturnType<typeof setTimeout> | undefined; // setCurrentTime を大量に呼び出さないようにするためのタイマー
    private qualityNames: string[] = []; // config の視聴設定名一覧
    private currentMode: number = 0;
    private videoApiModel: IVideoApiModel = container.get<IVideoApiModel>('IVideoApiModel'); // 再生中の視聴設定 (画質切替で更新される)
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private audioTracks: apid.VideoAudioTrack[] = [];
    private currentAudioTrack: apid.AudioTrackSpecifier = 'main';
    private deferredMpegtsCleanups = new Set<() => void>();
    private seekGeneration = 0;
    private initialPlaybackGateTimerId: ReturnType<typeof setTimeout> | undefined;
    private initialPlaybackGateActive = false;

    private static readonly INITIAL_PLAYBACK_BUFFER_SEC = 8;
    private static readonly INITIAL_PLAYBACK_GATE_INTERVAL_MS = 200;

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
        this.socketIoModel.onUpdateState(this.onUpdateStatus);
    }

    public async mounted(): Promise<void> {
        this.containerElement = this.$refs.container as HTMLElement;

        await this.videoState.clear();
        await this.updateVideoInfo();
        await this.fetchVideoFileSizeForDataBroadcasting(this.videoFileId);
        await this.fetchChapters();
        if (this.streamingType === 'm2tsll' || this.streamingType === 'mp4' || this.streamingType === 'webm') {
            await this.fetchAudioTracks();
        }

        // 画質切替用に視聴設定一覧を取得する
        const videoFileType = this.videoState.getVideoFileType(this.videoFileId);
        this.qualityNames = videoFileType === null ? [] : StreamQualityUtil.getRecordedModeNames(videoFileType, this.streamingType as StreamQualityUtil.RecordedStreamingType);
        this.currentMode = StreamQualityUtil.normalizeMode(this.qualityNames, this.mode);

        this.initVideoSetting();

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
    }

    /**
     * 録画ファイルのチャプターを取得する
     * 取得に失敗しても再生自体は続けられるため、エラーはログに残すだけにする
     * @return Promise<void>
     */
    private async fetchChapters(): Promise<void> {
        try {
            this.setChapters(await this.videoApiModel.getChapters(this.videoFileId));
        } catch (err) {
            console.error(err);
        }
    }

    private async fetchAudioTracks(): Promise<void> {
        try {
            this.audioTracks = await this.videoApiModel.getAudioTracks(this.videoFileId);
        } catch (err) {
            console.error(err);
            this.audioTracks = [];
        }
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
        this.socketIoModel.offUpdateState(this.onUpdateStatus);

        clearInterval(this.updateDurationTimerId);
        clearTimeout(this.setCurrentTimeTimerId);
        clearTimeout(this.initialPlaybackGateTimerId);
        this.initialPlaybackGateTimerId = undefined;
        this.initialPlaybackGateActive = false;
        this.cleanupDeferredMpegts();

        super.beforeUnmount();
    }

    /**
     * video 再生初期設定
     */
    protected initVideoSetting(): void {
        if (this.containerElement === null) {
            return;
        }

        const isM2TsLL = this.streamingType === 'm2tsll';
        if (isM2TsLL === true) {
            const support = StreamSupportUtil.checkM2TSLLSupport();
            if (support.isSupported === false) {
                this.snackbarState.open({ color: 'error', text: support.reason ?? '非対応ブラウザーです。' });
                throw new Error('UnsupportedBrowser');
            }
        }

        DPlayerUtil.setupGlobals();

        const videoSrc = this.createVideoSrc({
            videoFileId: this.videoFileId,
            streamingType: this.streamingType,
            mode: this.currentMode,
            playPosition: this.basePlayPosition,
            audioTrack: this.resolveStreamAudioTrack(this.currentAudioTrack),
        });

        // プレイヤー上から画質 (エンコード設定) を切り替えられるよう quality リストを生成する
        const qualities = StreamQualityUtil.createQualityList(this.qualityNames, videoSrc, isM2TsLL ? 'mpegts' : 'normal');

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
                          type: isM2TsLL ? 'mpegts' : 'normal',
                      },
            };

        if (isM2TsLL === true) {
            // mpegts.js / DPlayer に初回バッファ量の設定はないため、下で play() をゲートする。
            // 自動再生可否はブラウザーへ任せ、ゲートは手動再生にも適用する。
            options.autoplay = false;
            options.subtitle = { type: 'aribb24' };
            options.pluginOptions = {
                mpegts: {
                    config: {
                        enableWorker: true,
                        enableStashBuffer: true,
                        stashInitialSize: 64 * 1024,
                        liveBufferLatencyChasing: false,
                        // 録画入力はサーバー側の -readrate 2 と初期90秒バーストで供給量を抑える。
                        // lazyLoad は前方バッファ上限で HTTP 接続を切り、録画 m2tsll のサーバー側
                        // ストリーム停止を招くため使わない。録画配信は Range/再接続で継続する契約ではない。
                        // 代わりに再生済み領域だけを解放し、SourceBuffer の抱え込みを防ぐ。
                        autoCleanupSourceBuffer: true,
                        // 30秒まで遡ったら掃除し、15秒分はシーク戻り用に残す。
                        autoCleanupMaxBackwardDuration: 30,
                        autoCleanupMinBackwardDuration: 15,
                    },
                },
                aribb24: DPlayerUtil.createAribb24Options(),
            };
        }

        // チャプターをシークバー上のマーカーとして表示する
        this.applyChapterHighlights(options, this.getDuration());

        this.createPlayer(options);
        if (isM2TsLL === true) {
            this.setupInitialPlaybackBufferGate();
        }
        this.setPlaybackProfiles(this.playbackProfiles, this.streamingType as 'mp4' | 'webm' | 'm2tsll');
        if (this.audioTracks.length > 0) {
            this.setupRecordedAudioTrackSwitch();
        }
        if (isM2TsLL === true) {
            this.deferPreviousMpegtsDestroy();
        }

        // 画質切替時は現在の再生位置から配信し直す
        this.setupQualitySwitch({
            resolveUrl: async mode => {
                this.basePlayPosition = this.getCurrentTime();

                return this.createVideoSrc({
                    videoFileId: this.videoFileId,
                    streamingType: this.streamingType,
                    mode: mode,
                    playPosition: this.basePlayPosition,
                    audioTrack: this.resolveStreamAudioTrack(this.currentAudioTrack),
                });
            },
            resetCurrentTime: true,
            onSwitched: mode => {
                this.currentMode = mode;
                if (isM2TsLL === true) void Promise.resolve().then(() => this.reapplyEmbeddedAudioTrack(mode));
            },
            onPlaybackReady: () => {
                if (isM2TsLL === true) this.cleanupDeferredMpegts();
            },
        });
        if (isM2TsLL === true) this.setupMpegtsPlaybackRecovery();
    }

    /**
     * 初回再生を前方バッファが十分にたまるまで保留する。
     * @return void
     */
    private setupInitialPlaybackBufferGate(): void {
        if (this.dp === null) return;

        const dp = this.dp as any;
        const originalPlay = typeof dp.play === 'function' ? dp.play.bind(dp) : null;
        if (originalPlay === null) return;
        this.initialPlaybackGateActive = true;

        dp.play = (...args: any[]): void => {
            if (this.initialPlaybackGateActive === true && this.isInitialPlaybackBufferReady() === false) {
                this.scheduleInitialPlaybackGate();
                return;
            }
            this.initialPlaybackGateActive = false;
            clearTimeout(this.initialPlaybackGateTimerId);
            this.initialPlaybackGateTimerId = undefined;
            originalPlay(...args);
        };

        // デスクトップの従来の自動再生を、バッファゲート経由で開始する。
        if (UaUtil.isSafari() === false && UaUtil.isiOS() === false) this.scheduleInitialPlaybackGate();
    }

    /** 初回再生ゲートの判定を次のバッファ更新後へ繰り返す。 */
    private scheduleInitialPlaybackGate(): void {
        if (this.initialPlaybackGateActive === false || this.dp === null) return;
        clearTimeout(this.initialPlaybackGateTimerId);
        this.initialPlaybackGateTimerId = setTimeout(() => {
            if (this.initialPlaybackGateActive === false || this.dp === null) return;
            if (this.isInitialPlaybackBufferReady() === true) {
                this.initialPlaybackGateActive = false;
                this.initialPlaybackGateTimerId = undefined;
                (this.dp as any).play();
                return;
            }
            this.scheduleInitialPlaybackGate();
        }, RecordedStreamingVideo.INITIAL_PLAYBACK_GATE_INTERVAL_MS);
    }

    /** 現在の video 要素が初回再生に必要な前方バッファを持つか判定する。 */
    private isInitialPlaybackBufferReady(): boolean {
        const video = this.dp?.video;
        if (video === null || typeof video === 'undefined') return false;

        let bufferedEnd: number | null = null;
        try {
            if (video.buffered.length > 0) bufferedEnd = video.buffered.end(video.buffered.length - 1);
        } catch {
            return false;
        }

        return isInitialPlaybackBufferReady(
            video.currentTime,
            bufferedEnd,
            Number.isFinite(video.duration) ? video.duration : null,
            RecordedStreamingVideo.INITIAL_PLAYBACK_BUFFER_SEC,
        );
    }

    /**
     * video src を生成する
     */
    private createVideoSrc(info: VideoSrcInfo): string {
        // ss は API では小数も受け付けるが、ストリーム URL は整数秒へ揃える。
        // 小数のまま投げるとサーバ側で切り捨てられ、同じ位置でも URL が一致しなくなる
        const ss = normalizeStreamPlayPosition(info.playPosition);
        const audio = `&audioTrack=${encodeURIComponent(info.audioTrack ?? 'main')}`;
        // **m2tsll は絶対 url にする**。mpegts.js は Worker の中から fetch するため、
        // 相対 url (`./api/...`) では `Failed to parse URL` で読み込みに失敗する
        // (video 要素へ直接渡す mp4 / webm は相対 url のままで問題ない)
        const base =
            info.streamingType === 'm2tsll' ? `${window.location.origin}${Util.getSubDirectory()}/` : './';

        return `${base}api/streams/recorded/${info.videoFileId}/${info.streamingType}?mode=${info.mode}&ss=${ss}${audio}`;
    }

    private setupRecordedAudioTrackSwitch(): void {
        this.setupAudioTrackSwitch({
            tracks: this.audioTracks,
            current: this.currentAudioTrack,
            onSelect: async track => {
                const mpegts = (this.dp as any)?.plugins?.mpegts;
                if (
                    this.streamingType === 'm2tsll' &&
                    this.isEmbeddedAudioSwitchMode(this.currentMode) &&
                    typeof mpegts?.switchSecondaryAudio === 'function'
                ) {
                    if (RecordedStreamingVideo.isSecondaryAudioTrack(track)) mpegts.switchSecondaryAudio();
                    else mpegts.switchPrimaryAudio();
                    this.currentAudioTrack = track;
                    return;
                }
                this.currentAudioTrack = track;
                this.dp?.switchQuality(this.currentMode);
            },
        });
    }

    private isEmbeddedAudioSwitchMode(mode: number): boolean {
        return this.playbackProfiles.find(profile => profile.modes?.m2tsll === mode)?.embeddedAudioSwitch?.m2tsll === true;
    }

    private resolveStreamAudioTrack(track: apid.AudioTrackSpecifier): apid.AudioTrackSpecifier {
        return this.streamingType === 'm2tsll' &&
            (this.isEmbeddedAudioSwitchMode(this.currentMode) || RecordedStreamingVideo.isSecondaryAudioTrack(track) === false)
            ? 'all'
            : track;
    }

    private reapplyEmbeddedAudioTrack(mode: number): void {
        if (this.isEmbeddedAudioSwitchMode(mode) === false || RecordedStreamingVideo.isSecondaryAudioTrack(this.currentAudioTrack) === false) return;
        (this.dp as any)?.plugins?.mpegts?.switchSecondaryAudio?.();
    }

    /**
     * mpegts.js の旧インスタンスを、新 video の canplay まで保持する。
     * 同じ video 要素の switchVideo() では、DPlayer が src を設定する前に旧側を破棄する。
     */
    private deferPreviousMpegtsDestroy(): void {
        if (this.dp === null) return;
        const dp = this.dp as any;
        const originalInitMSE = typeof dp.initMSE === 'function' ? dp.initMSE.bind(dp) : null;
        if (originalInitMSE === null) return;
        const originalSwitchVideo = typeof dp.switchVideo === 'function' ? dp.switchVideo.bind(dp) : null;
        if (originalSwitchVideo !== null) {
            dp.switchVideo = (...args: any[]): void => {
                const video = args[0] as { type?: string } | undefined;
                const previousMpegts = dp.plugins?.mpegts;
                if (
                    video?.type === 'mpegts' &&
                    destroyMpegtsBeforeVideoReuse(previousMpegts, dp.video) === true
                ) {
                    // DPlayer は switchVideo() 内で video.src を設定してから initMSE() を呼ぶ。
                    // 同じ video 要素では、ここで旧側を破棄しないと新 URL を detach が消す。
                    this.disposeAribb24Renderers(dp);
                    delete dp.plugins.mpegts;
                }
                originalSwitchVideo(...args);
            };
        }
        dp.initMSE = (video: HTMLVideoElement, type: string): void => {
            this.cleanupDeferredMpegts();
            const previousMpegts = dp.plugins?.mpegts;
            if (type !== 'mpegts' || previousMpegts === null || typeof previousMpegts === 'undefined') {
                originalInitMSE(video, type);
                return;
            }
            const lifecycle = decideMpegTsLifecycle(previousMpegts, video);
            if (lifecycle === 'reset') {
                // レジューム・シークの switchVideo() は現在の video 要素を再利用する。
                // MediaSource / SourceBuffer / mpegts.js / ARIB renderer をここで全て捨て、
                // 絶対 PTS が前のストリームより小さい場合も旧時間軸へ append させない。
                this.disposeAribb24Renderers(dp);
                previousMpegts.destroy?.();
                delete dp.plugins.mpegts;
                originalInitMSE(video, type);
                return;
            }
            if (lifecycle !== 'defer') {
                originalInitMSE(video, type);
                return;
            }

            const previousCaption = dp.plugins?.aribb24Caption;
            const previousSuperimpose = dp.plugins?.aribb24Superimpose;
            dp.plugins.mpegts = undefined;
            dp.plugins.aribb24Caption = undefined;
            dp.plugins.aribb24Superimpose = undefined;
            try {
                originalInitMSE(video, type);
            } catch (err) {
                dp.plugins.mpegts = previousMpegts;
                dp.plugins.aribb24Caption = previousCaption;
                dp.plugins.aribb24Superimpose = previousSuperimpose;
                throw err;
            }
            try { previousCaption?.dispose?.(); } catch (err) { console.error(err); }
            try { previousSuperimpose?.dispose?.(); } catch (err) { console.error(err); }
            let finished = false;
            let timerId: number | undefined;
            const cleanup = (): void => {
                if (finished) return;
                finished = true;
                if (typeof timerId !== 'undefined') window.clearTimeout(timerId);
                this.deferredMpegtsCleanups.delete(cleanup);
                try { previousMpegts.unload?.(); } catch (err) { console.error(err); }
                try { previousMpegts.detachMediaElement?.(); } catch (err) { console.error(err); }
                try { previousMpegts.destroy?.(); } catch (err) { console.error(err); }
            };
            this.deferredMpegtsCleanups.add(cleanup);
            timerId = window.setTimeout(cleanup, 10_000);
        };
    }

    /** 旧 video 専用の ARIB renderer を新しい MediaSource へ持ち越さない。 */
    private disposeAribb24Renderers(dp: any): void {
        try { dp.plugins?.aribb24Caption?.dispose?.(); } catch (err) { console.error(err); }
        try { dp.plugins?.aribb24Superimpose?.dispose?.(); } catch (err) { console.error(err); }
        delete dp.plugins.aribb24Caption;
        delete dp.plugins.aribb24Superimpose;
    }

    private cleanupDeferredMpegts(): void {
        for (const cleanup of [...this.deferredMpegtsCleanups]) cleanup();
        this.deferredMpegtsCleanups.clear();
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
     * mp4 / webm のストリーミングは尺が不明なためバッファ済みの末尾を使う
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

    /** ストリーム再生成中のダミー位置を実況同期へ渡さない */
    protected getJikkyoPlaybackTime(): number | null {
        return resolveRecordedJikkyoPlaybackTime(this.getCurrentTime(), this.dummyPlayPosition !== null);
    }

    /**
     * 再生位置設定
     * @param time: number (秒)
     * @param resume?: boolean ストリーム作り直し後に再生を再開するか (シーク前の再生状態)
     */
    public setCurrentTime(time: number, resume?: boolean): void {
        if (this.dp === null) {
            return;
        }

        this.$emit('playbackTransition');
        // シークバーの端をつかむと僅かに負の値が来る。負のまま進めると
        // basePlayPosition が負になり、サーバへ負の ss を要求してしまう
        const duration = this.getDuration();
        time = Math.max(0, Number.isFinite(time) === true ? time : 0);
        if (duration > 0) {
            time = Math.min(time, duration);
        }

        // エンコード済み範囲か
        if (
            this.streamingType !== 'm2tsll' &&
            time >= this.basePlayPosition &&
            time <= this.basePlayPosition + super.getDuration()
        ) {
            super.setCurrentTime(time - this.basePlayPosition);
            this.onTimeupdate();

            return;
        }

        this.beginRecordedJikkyoTransition();
        const now = new Date().getTime();
        if (typeof resume === 'boolean') {
            // 呼び出し側 (VirtualTimeline) がシーク前の再生状態を持っているのでそれを使う。
            // ドラッグ中は一時停止しているため、この時点の paused() を見ても正しい値にならない
            this.pauseStateBeforeCurrentTime = resume === false;
            this.lastUpdatePauseState = now;
        } else if (this.dummyPlayPosition === null && now - this.lastUpdatePauseState > 1000) {
            this.pauseStateBeforeCurrentTime = this.paused();
            this.lastUpdatePauseState = now;
        }
        this.dummyPlayPosition = time;
        const seekGeneration = ++this.seekGeneration;
        this.onTimeupdate();

        clearTimeout(this.setCurrentTimeTimerId);
        this.setCurrentTimeTimerId = setTimeout(async () => {
            if (seekGeneration !== this.seekGeneration) return;
            if (this.dp === null) {
                // 解除しないと getCurrentTime() がダミー値を返し続け、シークバーが固まる
                this.dummyPlayPosition = null;

                return;
            }

            try {
                const playbackRate = this.dp.video.playbackRate;

                this.basePlayPosition = time;
                this.onWaiting();
                this.onPause();

                this.switchVideo({
                    url: this.createVideoSrc({
                        videoFileId: this.videoFileId,
                        streamingType: this.streamingType,
                        mode: this.currentMode,
                        playPosition: this.basePlayPosition,
                        audioTrack: this.resolveStreamAudioTrack(this.currentAudioTrack),
                    }),
                    type: this.streamingType === 'm2tsll' ? 'mpegts' : 'normal',
                });

                this.dp.video.playbackRate = playbackRate;
                if (this.pauseStateBeforeCurrentTime === true) {
                    this.pause();
                } else {
                    await this.play().catch(err => {
                        // console.error(err);
                    });
                }
            } finally {
                // switchVideo が失敗しても必ず解除する
                this.dummyPlayPosition = null;
                this.completeRecordedJikkyoSeek(time);
            }
        }, 200);
    }
}

namespace RecordedStreamingVideo {
    /**
     * 音声トラック指定子が副音声を指すか判定する
     * @param track: apid.AudioTrackSpecifier
     * @return boolean
     */
    export const isSecondaryAudioTrack = (track: apid.AudioTrackSpecifier): boolean => {
        if (track === 'sub') return true;
        if (track === 'main') return false;
        return Number.parseInt(track, 10) === 1;
    };
}

export default toNative(RecordedStreamingVideo);
</script>
