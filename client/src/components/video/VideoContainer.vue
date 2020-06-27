<template>
    <div class="video-container">
        <div class="video-content">
            <div v-if="isLoading === true || videoSrc === null" class="loading">
                <v-progress-circular :size="50" color="primary" indeterminate></v-progress-circular>
            </div>
            <div class="video-control-wrap" v-on:click="toggleControl">
                <transition name="fade">
                    <div>
                        <v-btn v-if="isShowControl === true" class="play-button mx-2" fab large v-on:click="togglePlay">
                            <v-icon v-if="isPause === true">mdi-play</v-icon>
                            <v-icon v-else>mdi-pause</v-icon>
                        </v-btn>
                        <div v-if="isShowControl === true" class="video-control">
                            <div class="content" v-on:click="clickController">
                                <v-slider
                                    class="slider"
                                    value="30"
                                    max="100"
                                    color="white"
                                    track-color="grey"
                                ></v-slider>
                                <div class="d-flex align-center mx-2">
                                    <v-btn icon dark v-on:click="togglePlay">
                                        <v-icon v-if="isPause === true">mdi-play</v-icon>
                                        <v-icon v-else>mdi-pause</v-icon>
                                    </v-btn>
                                    <div class="d-flex align-center volume-content">
                                        <v-btn icon dark>
                                            <v-icon>mdi-volume-high</v-icon>
                                        </v-btn>
                                        <v-slider
                                            class="slider"
                                            value="100"
                                            max="100"
                                            color="white"
                                            track-color="grey"
                                        ></v-slider>
                                    </div>
                                    <div class="time Caption mx-2">
                                        <span>00:00</span>
                                        <span class="mx-1">/</span>
                                        <span>00:00</span>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-btn icon dark>
                                        <v-icon>mdi-picture-in-picture-bottom-right</v-icon>
                                    </v-btn>
                                    <v-btn icon dark>
                                        <v-icon>mdi-fullscreen</v-icon>
                                    </v-btn>
                                </div>
                            </div>
                        </div>
                    </div>
                </transition>
            </div>
            <Video
                v-if="videoSrc !== null"
                ref="video"
                v-bind:videoSrc.sync="videoSrc"
                v-on:waiting="onWaiting"
                v-on:loadeddata="onLoadeddata"
                v-on:canplay="onCanplay"
                v-on:ended="onEnded"
                v-on:play="onPlay"
                v-on:pause="onPause"
            ></Video>
        </div>
    </div>
</template>

<script lang="ts">
import Video from '@/components/video/Video.vue';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import Util from '../../util/Util';

@Component({
    components: {
        Video,
    },
})
export default class VideoContainer extends Vue {
    @Prop({ required: true })
    public videoSrc!: string | null;

    public isLoading: boolean = true;
    public isPause: boolean = true;

    public isShowControl: boolean = false;

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

        if (this.isPause === true) {
            this.isShowControl = true;
        }

        setTimeout(() => {
            if (this.isPause === false) {
                this.isShowControl = false;
            }
        }, 300);
    }

    // 終了
    public onEnded(): void {
        this.isLoading = false;
    }

    // 再生
    public onPlay(): void {
        this.isPause = false;
    }

    // 停止
    public onPause(): void {
        this.isPause = true;
    }

    // video control 表示切り替え
    public toggleControl(): void {
        console.log('on toggle control');
        this.isShowControl = !this.isShowControl;
    }

    // 再生状態切り替え
    public togglePlay(e: Event): void {
        e.stopPropagation();

        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        if (this.isPause === true) {
            (<Video>this.$refs.video).play();
        } else {
            (<Video>this.$refs.video).pause();
        }
    }

    public clickController(e: Event): void {
        e.stopPropagation();
    }
}
</script>

<style lang="sass" scoped>
.fade-enter-active, .fade-leave-active
    transition: opacity .2s

.fade-enter, .fade-leave-to
    opacity: 0

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
        z-index: 3
        position: absolute
        height: 100%
        width: 100%
        display: flex
        flex-direction: column
        justify-content: center
        align-items: center

    .video-control-wrap
        z-index: 2
        position: relative
        height: 100%
        width: 100%

        .play-button
            position: absolute
            top: 50%
            left: 50%
            transform: translateY(-50%) translateX(-50%)
            opacity: 0.8

        .video-control
            height: 60px
            position: absolute
            bottom: 0
            width: 100%
            background: linear-gradient(to top, #000000d9, #0000)
            .content
                position: absolute
                width: 100%
                bottom: 0
                opacity: 0.8
                .volume-content
                    width: 100px
                .time
                    height: 36px
                    line-height: 36px
                    color: white
                    font-size: 12px
                    user-select: none

    video
        z-index: 1
        position: absolute
        top: 0
        right: 0
        bottom: 0
        left: 0
        margin: auto
        width: 100%
</style>

<style lang="sass">
.video-container
    .slider
        .v-slider
            min-height: 10px
        .v-input__slot
            margin: 0
        .v-messages
            display: none
</style>