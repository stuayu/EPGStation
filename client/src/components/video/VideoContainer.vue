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
                    v-on:waiting="onWaiting"
                    v-on:loadeddata="onLoadeddata"
                    v-on:canplay="onCanplay"
                ></NormalVideo>
                <LiveHLSVideo
                    v-if="videoParam.type == 'LiveHLS'"
                    ref="video"
                    v-bind:channelId="videoParam.channelId"
                    v-bind:mode="videoParam.mode"
                    v-on:waiting="onWaiting"
                    v-on:loadeddata="onLoadeddata"
                    v-on:canplay="onCanplay"
                ></LiveHLSVideo>
                <RecordedStreamingVideo
                    v-if="videoParam.type == 'RecordedStreaming'"
                    ref="video"
                    v-bind:recordedId="videoParam.recordedId"
                    v-bind:videoFileId="videoParam.videoFileId"
                    v-bind:streamingType="videoParam.streamingType"
                    v-bind:mode="videoParam.mode"
                    v-on:waiting="onWaiting"
                    v-on:loadeddata="onLoadeddata"
                    v-on:canplay="onCanplay"
                ></RecordedStreamingVideo>
                <RecordedHLSStreamingVideo
                    v-if="videoParam.type == 'RecordedHLS'"
                    ref="video"
                    v-bind:recordedId="videoParam.recordedId"
                    v-bind:videoFileId="videoParam.videoFileId"
                    v-bind:mode="videoParam.mode"
                    v-on:waiting="onWaiting"
                    v-on:loadeddata="onLoadeddata"
                    v-on:canplay="onCanplay"
                ></RecordedHLSStreamingVideo>
                <LiveMpegTsVideo
                    v-if="videoParam.type == 'LiveMpegTs'"
                    ref="video"
                    v-model:videoSrc="videoParam.src"
                    v-on:waiting="onWaiting"
                    v-on:loadeddata="onLoadeddata"
                    v-on:canplay="onCanplay"
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

    // DPlayer のフルスクリーン時にモバイル端末で画面回転をロックするための状態
    private isEnabledRotation: boolean = typeof window.screen.orientation !== 'undefined' && UaUtil.isMobile();
    private fullScreenListener = ((): void => {
        this.fullscreenChange();
    }).bind(this);

    public created(): void {
        document.addEventListener('webkitfullscreenchange', this.fullScreenListener, false);
        document.addEventListener('mozfullscreenchange', this.fullScreenListener, false);
        document.addEventListener('MSFullscreenChange', this.fullScreenListener, false);
        document.addEventListener('fullscreenchange', this.fullScreenListener, false);
    }

    public beforeUnmount(): void {
        document.removeEventListener('webkitfullscreenchange', this.fullScreenListener, false);
        document.removeEventListener('mozfullscreenchange', this.fullScreenListener, false);
        document.removeEventListener('MSFullscreenChange', this.fullScreenListener, false);
        document.removeEventListener('fullscreenchange', this.fullScreenListener, false);
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
