<template>
    <div class="video-container" ref="container">
        <div class="video-content" v-bind:class="{ 'is-ipad': isiPad === true }">
            <div v-if="isLoading === true" class="loading">
                <v-progress-circular :size="50" color="primary" indeterminate></v-progress-circular>
            </div>
            <div class="video-wrap">
                <NormalVideo
                    v-if="videoParam.type == 'Normal'"
                    ref="video"
                    v-model:videoSrc="videoParam.src"
                    v-bind:videoFileId="videoParam.videoFileId ?? null"
                    v-bind:jikkyoChannelId="videoParam.jikkyoChannelId"
                    v-bind:jikkyoStartAt="videoParam.jikkyoStartAt"
                    v-bind:jikkyoEndAt="videoParam.jikkyoEndAt"
                    v-on:waiting="onWaiting"
                    v-on:loadeddata="onLoadeddata"
                    v-on:canplay="onCanplay"
                    v-on:jikkyoComment="onJikkyoComment"
                    v-on:timeupdate="onTimeupdate"
                    v-on:pause="savePlaybackPosition"
                    v-on:ended="onEnded"
                ></NormalVideo>
                <LiveHLSVideo
                    v-if="videoParam.type == 'LiveHLS'"
                    ref="video"
                    v-bind:channelId="videoParam.channelId"
                    v-bind:mode="videoParam.mode"
                    v-bind:jikkyoChannelId="videoParam.jikkyoChannelId"
                    v-on:waiting="onWaiting"
                    v-on:loadeddata="onLoadeddata"
                    v-on:canplay="onCanplay"
                    v-on:jikkyoComment="onJikkyoComment"
                ></LiveHLSVideo>
                <RecordedStreamingVideo
                    v-if="videoParam.type == 'RecordedStreaming'"
                    ref="video"
                    v-bind:recordedId="videoParam.recordedId"
                    v-bind:videoFileId="videoParam.videoFileId"
                    v-bind:streamingType="videoParam.streamingType"
                    v-bind:mode="videoParam.mode"
                    v-bind:jikkyoChannelId="videoParam.jikkyoChannelId"
                    v-bind:jikkyoStartAt="videoParam.jikkyoStartAt"
                    v-bind:jikkyoEndAt="videoParam.jikkyoEndAt"
                    v-on:waiting="onWaiting"
                    v-on:loadeddata="onLoadeddata"
                    v-on:canplay="onCanplay"
                    v-on:jikkyoComment="onJikkyoComment"
                    v-on:timeupdate="onTimeupdate"
                    v-on:pause="savePlaybackPosition"
                    v-on:ended="onEnded"
                ></RecordedStreamingVideo>
                <RecordedHLSStreamingVideo
                    v-if="videoParam.type == 'RecordedHLS'"
                    ref="video"
                    v-bind:recordedId="videoParam.recordedId"
                    v-bind:videoFileId="videoParam.videoFileId"
                    v-bind:mode="videoParam.mode"
                    v-bind:jikkyoChannelId="videoParam.jikkyoChannelId"
                    v-bind:jikkyoStartAt="videoParam.jikkyoStartAt"
                    v-bind:jikkyoEndAt="videoParam.jikkyoEndAt"
                    v-on:waiting="onWaiting"
                    v-on:loadeddata="onLoadeddata"
                    v-on:canplay="onCanplay"
                    v-on:jikkyoComment="onJikkyoComment"
                    v-on:timeupdate="onTimeupdate"
                    v-on:pause="savePlaybackPosition"
                    v-on:ended="onEnded"
                ></RecordedHLSStreamingVideo>
                <LiveMpegTsVideo
                    v-if="videoParam.type == 'LiveMpegTs'"
                    ref="video"
                    v-model:videoSrc="videoParam.src"
                    v-bind:channelId="videoParam.channelId"
                    v-bind:mode="videoParam.mode"
                    v-bind:jikkyoChannelId="videoParam.jikkyoChannelId"
                    v-on:waiting="onWaiting"
                    v-on:loadeddata="onLoadeddata"
                    v-on:canplay="onCanplay"
                    v-on:jikkyoComment="onJikkyoComment"
                ></LiveMpegTsVideo>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import LiveHLSVideo from '@/components/video/LiveHLSVideo.vue';
import NormalVideo from '@/components/video/NormalVideo.vue';
import RecordedHLSStreamingVideo from '@/components/video/RecordedHLSStreamingVideo.vue';
import RecordedStreamingVideo from '@/components/video/RecordedStreamingVideo.vue';
import LiveMpegTsVideo from '@/components/video/LiveMpegTsVideo.vue';
import * as VideoParam from '@/components/video/ViedoParam';
import UaUtil from '@/util/UaUtil';
import BaseVideo from '@/components/video/BaseVideo';
import container from '@/model/ModelContainer';
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import DPlayer from 'dplayer';
import { DataBroadcastingConnectParam } from '@/util/DataBroadcastingManager';
import { JikkyoComment } from '@/util/JikkyoCommentClient';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';

@Component({
    components: {
        NormalVideo,
        LiveHLSVideo,
        RecordedStreamingVideo,
        RecordedHLSStreamingVideo,
        LiveMpegTsVideo,
    },
})
class VideoContainer extends Vue {
    @Prop({ required: true })
    public videoParam!: VideoParam.BaseVideoParam;

    public isLoading: boolean = true;
    public isiPad: boolean = UaUtil.isiPadOS();
    private videoApi = container.get<IVideoApiModel>('IVideoApiModel');
    private lastSavedAt = 0;
    // 生成時に固定する再生対象のビデオファイル ID (再生位置の保存・復元に使う)
    private playingVideoFileId: number | null = null;
    private resumeApplied = false;
    // レジューム適用 (GET 待ち) が完了するまで再生位置の保存を抑止し、
    // 最初の timeupdate が position≈0 を PUT して履歴を上書きしてしまうレースを防ぐ
    private resumeReady = false;

    // DPlayer のフルスクリーン時にモバイル端末で画面回転をロックするための状態
    private isEnabledRotation: boolean = typeof window.screen.orientation !== 'undefined' && UaUtil.isMobile();
    private fullScreenListener = ((): void => {
        this.fullscreenChange();
    }).bind(this);

    // タブを閉じる・リロード・バックグラウンド化した場合でも再生位置を beacon で送信する
    private pageHideListener = ((): void => {
        this.savePlaybackPositionWithBeacon();
    }).bind(this);
    private visibilityChangeListener = ((): void => {
        if (document.visibilityState === 'hidden') this.savePlaybackPositionWithBeacon();
    }).bind(this);

    public created(): void {
        // 再生対象は生成時に固定する。
        // 動画を切り替えると親が videoParam を差し替えてからこのコンポーネントを破棄するため、
        // 破棄時の再生位置保存で参照すると「古い再生位置を新しいビデオファイルの履歴に書く」ことになる
        this.playingVideoFileId = 'videoFileId' in this.videoParam && typeof this.videoParam.videoFileId === 'number' ? this.videoParam.videoFileId : null;

        document.addEventListener('webkitfullscreenchange', this.fullScreenListener, false);
        document.addEventListener('mozfullscreenchange', this.fullScreenListener, false);
        document.addEventListener('MSFullscreenChange', this.fullScreenListener, false);
        document.addEventListener('fullscreenchange', this.fullScreenListener, false);
        window.addEventListener('pagehide', this.pageHideListener, false);
        document.addEventListener('visibilitychange', this.visibilityChangeListener, false);
    }

    public beforeUnmount(): void {
        this.savePlaybackPositionWithBeacon();
        document.removeEventListener('webkitfullscreenchange', this.fullScreenListener, false);
        document.removeEventListener('mozfullscreenchange', this.fullScreenListener, false);
        document.removeEventListener('MSFullscreenChange', this.fullScreenListener, false);
        document.removeEventListener('fullscreenchange', this.fullScreenListener, false);
        window.removeEventListener('pagehide', this.pageHideListener, false);
        document.removeEventListener('visibilitychange', this.visibilityChangeListener, false);
    }

    /**
     * fullscreen の状態が変化したときに呼ばれる (モバイル端末での画面回転ロック用)
     */
    private async fullscreenChange(): Promise<void> {
        if (this.isEnabledRotation === false) {
            return;
        }

        const isFullscreen = this.checkFullscreen();

        try {
            if (isFullscreen === true) {
                if (this.isLandscape() === false) {
                    await (window.screen as any).orientation.lock('landscape');
                }
            } else {
                await (window.screen as any).orientation.lock('natural');
            }
        } catch (err) {
            console.error(err);
        }
    }

    private checkFullscreen(): boolean {
        return !!(
            (document as any).fullScreen ||
            (document as any).webkitIsFullScreen ||
            (document as any).mozFullScreen ||
            (document as any).msFullscreenElement ||
            (document as any).fullscreenElement
        );
    }

    /**
     * 回転状態か？
     * @return boolean true で回転状態
     */
    private isLandscape(): boolean {
        return !this.isEnabledRotation || (window.screen as any).orientation.angle !== 0;
    }

    // 読み込み中
    public onWaiting(): void {
        this.isLoading = true;
    }

    // 読み込み完了
    public onLoadeddata(): void {
        this.isLoading = false;
    }

    // 再生可能
    public onCanplay(): void {
        this.isLoading = false;
        void this.applyResumePosition();
        this.$emit('canplay');
    }

    // 実況コメント (弾幕として描画したものを視聴画面の右パネルへ中継する)
    public onJikkyoComment(comment: JikkyoComment): void {
        this.$emit('jikkyoComment', comment);
    }

    // 直前の timeupdate 時点の再生位置 (秒)。データ放送のシーク検知に使う
    private lastPlaybackTimeSec: number | null = null;
    // この秒数を超える再生位置の飛びをシークとみなす (通常再生の timeupdate は数百ms〜数秒間隔の連続増加のため)
    private readonly dataBroadcastingSeekThresholdSec = 3;

    public onTimeupdate(): void {
        this.emitRemainingTime();
        this.checkDataBroadcastingSeek();
        if (this.resumeReady === false) return;
        if (Date.now() - this.lastSavedAt >= 10000) void this.savePlaybackPosition();
    }

    /**
     * データ放送 (BML) レイヤーが録画ファイル内のバイト位置を再計算すべきタイミング (シーク) を検知して親へ通知する。
     * レジューム適用直後 (再生開始位置の確定) も対象に含める
     */
    private checkDataBroadcastingSeek(): void {
        const video = this.getVideo();
        if (video === null) return;
        const current = video.getCurrentTime();
        if (this.lastPlaybackTimeSec === null || Math.abs(current - this.lastPlaybackTimeSec) > this.dataBroadcastingSeekThresholdSec) {
            this.$emit('dataBroadcastingSeek', current);
        }
        this.lastPlaybackTimeSec = current;
    }

    public onEnded(): void {
        void this.savePlaybackPosition();
        this.$emit('ended');
    }

    /**
     * 再生終了までの残り秒数を親コンポーネントへ通知する (連続再生のカウントダウン表示用)
     */
    private emitRemainingTime(): void {
        const video = this.getVideo();
        if (video === null) return;
        const duration = video.getDuration();
        if (duration <= 0) return;
        this.$emit('remainingTime', Math.max(0, duration - video.getCurrentTime()));
    }

    public async savePlaybackPosition(): Promise<void> {
        // レジューム適用が完了する前に保存すると position≈0 で履歴を上書きしてしまうため抑止する
        if (this.resumeReady === false) return;
        const id = this.getVideoFileId();
        const video = this.getVideo();
        if (id === null || video === null) return;
        const duration = video.getDuration();
        if (duration <= 0) return;
        this.lastSavedAt = Date.now();
        await this.videoApi.savePlaybackPosition(id, { position: video.getCurrentTime(), duration }).catch(console.error);
    }

    private savePlaybackPositionWithBeacon(): void {
        const id = this.getVideoFileId();
        const video = this.getVideo();
        if (id === null || video === null || video.getDuration() <= 0) return;
        this.videoApi.savePlaybackPositionWithBeacon(id, { position: video.getCurrentTime(), duration: video.getDuration() });
    }

    private async applyResumePosition(): Promise<void> {
        if (this.resumeApplied) return;
        this.resumeApplied = true;
        const id = this.getVideoFileId();
        const video = this.getVideo();
        if (id === null || video === null) {
            this.resumeReady = true;

            return;
        }
        try {
            const history = await this.videoApi.getPlaybackPosition(id).catch(() => null);
            if (history !== null && history.status !== 'watched' && history.position > 0) video.setCurrentTime(history.position);
        } finally {
            this.resumeReady = true;
        }
    }

    /**
     * データ放送 (BML) 機能の初期化に必要な DPlayer インスタンスと接続パラメータを返す
     * どちらも揃わない (video 未生成・当該 video が非対応) 場合は null
     * @return { dp: DPlayer; param: DataBroadcastingConnectParam } | null
     */
    public getDataBroadcastingContext(): { dp: DPlayer; param: DataBroadcastingConnectParam } | null {
        const video = this.getVideo();
        if (video === null) return null;

        const dp = video.getDPlayer();
        const param = video.getDataBroadcastingParam();
        if (dp === null || param === null) return null;

        return { dp, param };
    }

    private getVideo(): BaseVideo | null {
        return (this.$refs.video as BaseVideo | undefined) ?? null;
    }
    private getVideoFileId(): number | null {
        return this.playingVideoFileId;
    }
}

export default toNative(VideoContainer);
</script>

<style lang="sass" scoped>
.video-container
    position: relative
    max-width: 100%
    background: black

    &::before
        content: ""
        display: block
        padding-top: 56.25%

    .video-content
        position: absolute
        top: 0
        left: 0
        width: 100%
        height: 100%

    .loading
        z-index: 2
        position: absolute
        height: 100%
        width: 100%
        display: flex
        flex-direction: column
        justify-content: center
        align-items: center
        pointer-events: none

    .video-wrap
        z-index: 1
        position: absolute
        top: 0
        right: 0
        bottom: 0
        left: 0
        margin: auto
        width: 100%
        height: 100%

        .dplayer-wrap
            width: 100%
            height: 100%

    .video-content
        &.is-ipad
            .dplayer-subtitle
                font-size: 26px
</style>
