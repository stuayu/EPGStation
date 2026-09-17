<template>
    <div ref="container" class="dplayer-wrap"></div>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import DPlayerUtil from '@/util/DPlayerUtil';
import StreamSupportUtil from '@/util/StreamSupportUtil';
import { DPlayerType } from 'dplayer';
import * as apid from '../../../../api';
import { destroyMpegtsBeforeVideoReuse } from '../../../../src/util/MpegTsLifecycleUtil';
import { decideOfflineAudioTrackSwitch } from '../../../../src/util/AudioTrackSwitchDecision';
import { createOfflineDataBroadcastingParam, resolveOfflineAudioTracks } from '../../../../src/util/OfflineUxUtil';
import {
    calculateOfflineOriginalOffset,
    createOfflineOriginalOffsetUrl,
    isOfflinePositionBuffered,
    resolveOfflinePlaybackDuration,
    normalizeOfflinePlaybackPosition,
} from '../../../../src/util/OfflinePlaybackUtil';
import { Component, Prop, toNative } from 'vue-facing-decorator';

/** 保存済み元 TS の HEVC を Range VOD として mpegts.js へ渡すプレイヤー。 */
@Component({})
class OfflineHevcVideo extends BaseVideo {
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    protected override shouldNoticeJikkyoError(): boolean { return false; }

    @Prop({ required: true })
    public videoSrc!: string;

    @Prop({ required: true })
    public durationSeconds!: number;

    @Prop({ default: undefined })
    public offlineOriginalFileSize!: number | undefined;

    @Prop({ default: 0 })
    public playPosition!: number;

    @Prop({ default: () => [] })
    public offlineChapters!: apid.VideoChapter[];

    @Prop({ default: undefined })
    public offlineAudioTracks!: apid.VideoAudioTrack[] | undefined;

    @Prop({ default: undefined })
    public offlineDataBroadcastingVideoFileId!: apid.VideoFileId | undefined;

    @Prop({ default: undefined })
    public offlineDataBroadcastingFileSize!: number | undefined;

    @Prop({ default: undefined })
    public offlineDataBroadcastingChunkSize!: number | undefined;

    @Prop({ default: undefined })
    public offlineDataBroadcastingStartAt!: number | undefined;

    @Prop({ default: null })
    public jikkyoChannelId!: string | null;

    @Prop({ default: null })
    public jikkyoStartAt!: number | null;

    @Prop({ default: null })
    public jikkyoEndAt!: number | null;

    private audioTracks: apid.VideoAudioTrack[] = [];
    private currentAudioTrack: apid.AudioTrackSpecifier = 'main';
    private basePlayPosition = 0;
    private dummyPlayPosition: number | null = null;
    private reloadTimerId: ReturnType<typeof setTimeout> | undefined;
    private reloadGeneration = 0;
    private initialPositionPending: number | null = null;

    protected getJikkyoKakologOption(): { jikkyoChannelId: string; startAt: number; endAt: number } | null {
        if (this.jikkyoChannelId === null || this.jikkyoStartAt === null || this.jikkyoEndAt === null) return null;
        return { jikkyoChannelId: this.jikkyoChannelId, startAt: this.jikkyoStartAt, endAt: this.jikkyoEndAt };
    }

    public mounted(): void {
        this.containerElement = this.$refs.container as HTMLElement;
        this.setChapters(this.offlineChapters);
        this.setDataBroadcastingFileInfo(this.offlineDataBroadcastingFileSize ?? null, this.offlineDataBroadcastingStartAt ?? null);
        // オフラインは保存済み Range VOD のため、オンライン再生の WebKit + 10bit
        // 実時間デコード制限を適用せず、mpegts.js の HEVC transmux 可否だけを見る。
        // 保存済み HEVC の黒画面はこの判定ではなく、Range 無し要求を Service Worker が
        // 416 にしていたことが原因。Range 無しは全体 200 として扱う。
        const support = StreamSupportUtil.checkOfflineMpegTsHevcSupport();
        if (support.isSupported === false) {
            // 例外を投げるだけだと画面が黒いままになるので、理由を画面へ出す
            this.snackbarState.open({ color: 'error', text: support.reason ?? '非対応ブラウザーです。' });
            throw new Error(support.reason ?? '非対応ブラウザーです。');
        }
        DPlayerUtil.enableMpegtsHevcPlayback();
        this.basePlayPosition = normalizeOfflinePlaybackPosition(this.playPosition, this.durationSeconds);
        // VideoContainer は初期 canplay 後にも同じ位置を渡すため、0 秒も重複読み直しを抑止する。
        this.initialPositionPending = this.basePlayPosition;
        this.initVideoSetting();
        this.audioTracks = resolveOfflineAudioTracks(this.offlineAudioTracks);
        this.setupAudioTrackSwitch({
            tracks: this.audioTracks,
            current: this.currentAudioTrack,
            onSelect: async track => {
                const action = decideOfflineAudioTrackSwitch(
                    this.currentAudioTrack,
                    track,
                    this.isDualMonoSwitch(this.currentAudioTrack, track),
                );
                if (action === 'noop') return;
                if (action === 'dual-mono') {
                    await this.selectDualMonoAudioTrack(track);
                } else {
                    await this.reloadForAudioTrack(track);
                }
                this.currentAudioTrack = track;
            },
        });
    }

    protected override isEnabledVirtualTimeline(): boolean { return true; }

    public override getDuration(): number { return resolveOfflinePlaybackDuration(super.getDuration(), this.durationSeconds); }

    public override getCurrentTime(): number {
        if (this.dummyPlayPosition !== null) return this.dummyPlayPosition;
        return this.basePlayPosition + super.getCurrentTime();
    }

    public override getEncodedTime(): number {
        return Math.min(this.basePlayPosition + super.getEncodedTime(), this.getDuration());
    }

    /** 保存済み元 TS の音声一覧が同じデュアルモノラル ES の2択か判定する。 */
    private isDualMonoSwitch(current: apid.AudioTrackSpecifier, next: apid.AudioTrackSpecifier): boolean {
        return this.audioTracks.find(item => item.track === current)?.isDualMono === true &&
            this.audioTracks.find(item => item.track === next)?.isDualMono === true;
    }

    /** buffered の絶対時間を読み、範囲内なら mpegts.js の通常 seek を使う。 */
    private isBufferedPosition(position: number): boolean {
        if (this.dp === null) return false;
        const video = this.dp.video;
        const buffered: { start: number; end: number }[] = [];
        try {
            for (let i = 0; i < video.buffered.length; i += 1) buffered.push({ start: video.buffered.start(i), end: video.buffered.end(i) });
        } catch {
            return false;
        }
        return isOfflinePositionBuffered(position, this.basePlayPosition, buffered);
    }

    /** VirtualTimeline から渡された絶対位置を、buffered 内 seek または TS 読み直しへ振り分ける。 */
    public override setCurrentTime(time: number, resume?: boolean): void {
        if (this.dp === null) return;
        const position = normalizeOfflinePlaybackPosition(time, this.getDuration());
        if (
            this.initialPositionPending !== null &&
            Math.abs(position - this.initialPositionPending) < 0.01 &&
            this.basePlayPosition === this.initialPositionPending &&
            super.getCurrentTime() <= 1
        ) {
            this.initialPositionPending = null;
            return;
        }
        this.initialPositionPending = null;
        if (this.isBufferedPosition(position) === true) {
            super.setCurrentTime(position - this.basePlayPosition, resume);
            this.onTimeupdate();
            return;
        }

        const shouldResume = typeof resume === 'boolean' ? resume : this.dp.video.paused === false;
        this.dummyPlayPosition = position;
        const generation = ++this.reloadGeneration;
        clearTimeout(this.reloadTimerId);
        this.reloadTimerId = setTimeout(() => {
            void this.reloadAt(position, shouldResume, this.currentAudioTrack, generation);
        }, 200);
        this.onTimeupdate();
    }

    /**
     * 先読み済み範囲を捨て、同じ位置から独立音声 ES を読み直す。
     * mpegts.js の新個体を生成してから、PMT 解析前の transmuxer へ音声指定を渡す。
     * @param track: apid.AudioTrackSpecifier
     */
    private async reloadForAudioTrack(track: apid.AudioTrackSpecifier): Promise<void> {
        if (this.dp === null) return;
        const position = this.getCurrentTime();
        const wasPaused = this.dp.video.paused;
        await this.reloadAt(position, wasPaused === false, track, ++this.reloadGeneration);
    }

    /** offset URLで MPEG-TS を読み直し、再生状態・速度・絶対位置を復元する。 */
    private async reloadAt(
        position: number,
        shouldResume: boolean,
        audioTrack: apid.AudioTrackSpecifier,
        generation: number,
    ): Promise<void> {
        if (this.dp === null || generation !== this.reloadGeneration) return;
        const dp = this.dp as any;
        const playbackRate = dp.video.playbackRate;
        this.basePlayPosition = position;
        this.onWaiting();
        this.onPause();
        try {
            // DPlayer 1.33.1 の switchVideo() は video.src を設定してから initMSE() で旧 backend を破棄する。
            // その破棄 (detachMediaElement) が src を消すため、新しい mpegts.js が空 URL で初期化をスキップする。
            // RecordedStreamingVideo と同じく、新 URL を設定する前に DPlayer に旧 backend を1回だけ破棄させる。
            destroyMpegtsBeforeVideoReuse(dp.plugins?.mpegts, dp.video, dp);
            // 新しい TSDemuxer が最初の PMT から選択中の音声 ES を選ぶよう、生成時の config で渡す
            // (vite.config.ts が mpegts.js dist に当てる patchMpegtsSecondaryAudioPreference が読む)
            const mpegtsConfig = dp.options?.pluginOptions?.mpegts?.config;
            if (mpegtsConfig !== null && typeof mpegtsConfig === 'object') {
                mpegtsConfig.preferSecondaryAudio =
                    audioTrack === 'sub' || (audioTrack !== 'main' && Number.parseInt(audioTrack, 10) === 1);
            }
            this.switchVideo({
                url: createOfflineOriginalOffsetUrl(
                    this.videoSrc,
                    calculateOfflineOriginalOffset(position, this.offlineOriginalFileSize ?? 0, this.durationSeconds),
                ),
                type: 'mpegts',
            });
            if (generation !== this.reloadGeneration || this.dp === null) return;

            const mpegts = (this.dp as any).plugins?.mpegts;
            const isSecondary = audioTrack === 'sub' || (audioTrack !== 'main' && Number.parseInt(audioTrack, 10) === 1);
            const switchAudio = isSecondary ? mpegts?.switchSecondaryAudio : mpegts?.switchPrimaryAudio;
            if (typeof switchAudio !== 'function') {
                this.snackbarState.open({ color: 'error', text: 'この端末では音声を切り替えられません。' });
                throw new Error('OfflineAudioTrackSwitchUnavailable');
            }
            // deferLoadAfterSourceOpen=false により switchVideo 内 load() が transmuxer を同期生成する。
            // sourceopen 待ちや内部シーク処理へ依存せず、PMT 解析前に指定できる。
            switchAudio.call(mpegts);
            this.currentAudioTrack = audioTrack;
            this.dp.video.playbackRate = playbackRate;
            if (shouldResume === true) await this.resumeAfterReload(generation);
            else this.pause();
        } finally {
            if (generation === this.reloadGeneration) {
                this.dummyPlayPosition = null;
                this.completeRecordedJikkyoSeek(position);
                this.onTimeupdate();
            }
        }
    }

    /**
     * 作り直した mpegts.js で再生を再開する。
     *
     * switchVideo() 直後に play() すると、mpegts.js の読み込み開始 (新しい load) に割り込まれて
     * play() が中断される。DPlayer の play() は失敗時に自分で pause() するため、pause() の呼び出しが
     * 無くても停止状態のまま残り、シークすると止まってしまう (Android 相当の Chromium で再現)。
     * 再生可能になってから play() し、まだ停止していれば間隔を空けて再試行する。
     * @param generation: number 読み直しの世代。途中で次の読み直しが始まったら何もしない
     */
    private async resumeAfterReload(generation: number): Promise<void> {
        const video = this.dp?.video;
        if (typeof video === 'undefined') return;

        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            await new Promise<void>(resolve => {
                const done = (): void => {
                    clearTimeout(timerId);
                    video.removeEventListener('canplay', done);
                    video.removeEventListener('loadeddata', done);
                    resolve();
                };
                const timerId = setTimeout(done, OfflineHevcVideo.RESUME_READY_TIMEOUT_MS);
                video.addEventListener('canplay', done);
                video.addEventListener('loadeddata', done);
            });
        }

        for (let attempt = 0; attempt < OfflineHevcVideo.RESUME_MAX_ATTEMPTS; attempt += 1) {
            if (generation !== this.reloadGeneration || this.dp === null) return;
            await this.play().catch(() => undefined);
            await new Promise(resolve => setTimeout(resolve, OfflineHevcVideo.RESUME_CHECK_INTERVAL_MS));
            if (generation !== this.reloadGeneration || this.dp === null) return;
            if (this.dp.video.paused === false) return;
        }
    }

    private static readonly RESUME_READY_TIMEOUT_MS = 10000;
    private static readonly RESUME_MAX_ATTEMPTS = 3;
    private static readonly RESUME_CHECK_INTERVAL_MS = 400;

    public beforeUnmount(): void {
        clearTimeout(this.reloadTimerId);
        this.reloadGeneration += 1;
        super.beforeUnmount();
    }

    public override getDataBroadcastingParam() {
        return this.offlineDataBroadcastingVideoFileId === undefined
            ? null
            : createOfflineDataBroadcastingParam(
                  this.offlineDataBroadcastingVideoFileId,
                  this.videoSrc,
                  this.offlineDataBroadcastingFileSize ?? 0,
                  this.offlineDataBroadcastingStartAt,
                  this.offlineDataBroadcastingChunkSize,
              );
    }

    protected initVideoSetting(): void {
        if (this.containerElement === null) return;
        DPlayerUtil.setupGlobals();
        const options: DPlayerType.Options = {
            container: this.containerElement,
            autoplay: true,
            live: false,
            video: { url: createOfflineOriginalOffsetUrl(this.videoSrc, calculateOfflineOriginalOffset(this.basePlayPosition, this.offlineOriginalFileSize ?? 0, this.durationSeconds)), type: 'mpegts' },
            subtitle: { type: 'aribb24' },
            pluginOptions: {
                mpegts: {
                    // DPlayer 1.33.1 は initMSE() で video.src を上書きするが、再入初期化や
                    // ラッパー経由でも URL を失わないよう設定側にも同じ URL を保持する。
                    mediaDataSource: {
                        type: 'mpegts',
                        isLive: false,
                        url: this.videoSrc,
                    } as any,
                    config: {
                        isLive: false,
                        enableWorker: true,
                        enableStashBuffer: true,
                        stashInitialSize: 64 * 1024,
                        deferLoadAfterSourceOpen: false,
                        autoCleanupSourceBuffer: true,
                        autoCleanupMaxBackwardDuration: 30,
                        autoCleanupMinBackwardDuration: 15,
                    },
                },
                aribb24: DPlayerUtil.createAribb24Options(),
            },
        };
        this.applyChapterHighlights(options, this.durationSeconds);
        this.createPlayer(options);
    }
}

export default toNative(OfflineHevcVideo);
</script>
