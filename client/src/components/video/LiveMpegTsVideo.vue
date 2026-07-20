<template>
    <div ref="container" class="dplayer-wrap"></div>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import DPlayerUtil from '@/util/DPlayerUtil';
import { DPlayerType } from 'dplayer';
import Mpegts from 'mpegts.js';
import { Component, Prop, toNative } from 'vue-facing-decorator';

@Component({})
class LiveMpegTsVideo extends BaseVideo {
    @Prop({ required: true })
    public videoSrc!: string;

    @Prop({ default: null })
    public jikkyoChannelId!: string | null;

    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    public mounted(): void {
        super.mounted();
    }

    /**
     * ニコニコ実況の実況チャンネル ID を返す
     */
    protected getJikkyoChannelId(): string | null {
        return this.jikkyoChannelId;
    }

    public async beforeUnmount(): Promise<void> {
        super.beforeUnmount();
    }

    /**
     * video 再生初期設定
     */
    protected initVideoSetting(): void {
        if (this.containerElement === null) {
            return;
        }

        // 対応しているか確認
        if (Mpegts.isSupported() === false || Mpegts.getFeatureList().mseLivePlayback === false) {
            this.snackbarState.open({
                color: 'error',
                text: '非対応ブラウザーです。',
            });

            throw new Error('UnsupportedBrowser');
        }

        DPlayerUtil.setupGlobals();

        const options: DPlayerType.Options = {
            container: this.containerElement,
            autoplay: true,
            live: true,
            hotkey: true,
            video: {
                url: this.videoSrc,
                type: 'mpegts',
            },
            subtitle: {
                type: 'aribb24',
            },
            pluginOptions: {
                mpegts: {
                    config: {
                        enableWorker: true,
                        liveBufferLatencyChasing: true,
                        liveBufferLatencyMinRemain: 1.0,
                        liveBufferLatencyMaxLatency: 2.0,
                    },
                },
                aribb24: DPlayerUtil.createAribb24Options(),
            },
        };

        this.createPlayer(options);
    }

    /**
     * 動画の長さを返す (秒)
     * @return number
     */
    public getDuration(): number {
        return 0;
    }

    /**
     * 動画の現在再生位置を返す (秒)
     * @return number
     */
    public getCurrentTime(): number {
        return 0;
    }

    /**
     * 再生位置設定
     * @param time: number (秒)
     */
    public setCurrentTime(time: number): void {
        return;
    }
}

export default toNative(LiveMpegTsVideo);
</script>
