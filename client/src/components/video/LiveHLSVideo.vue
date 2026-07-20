<template>
    <div ref="container" class="dplayer-wrap"></div>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import container from '@/model/ModelContainer';
import ILiveHLSVideoState from '@/model/state/onair/ILiveHLSVideoState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import DPlayerUtil from '@/util/DPlayerUtil';
import UaUtil from '@/util/UaUtil';
import { DPlayerType } from 'dplayer';
import { Component, Prop, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../api';

@Component({})
class LiveHLSVideo extends BaseVideo {
    @Prop({ required: true })
    public channelId!: apid.ChannelId;

    @Prop({ required: true })
    public mode!: number;

    @Prop({ default: null })
    public jikkyoChannelId!: string | null;

    /**
     * ニコニコ実況の実況チャンネル ID を返す
     */
    protected getJikkyoChannelId(): string | null {
        return this.jikkyoChannelId;
    }

    private videoState: ILiveHLSVideoState = container.get<ILiveHLSVideoState>('ILiveHLSVideoState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private checkEnabledTimerId: ReturnType<typeof setTimeout> | undefined;

    public async mounted(): Promise<void> {
        this.containerElement = this.$refs.container as HTMLElement;

        // HLS stream 開始
        await this.videoState.start(this.channelId, this.mode).catch(err => {
            this.snackbarState.open({
                color: 'error',
                text: 'ストリーム開始に失敗',
            });
        });

        // ストリームが有効になるまで待つ
        this.checkEnabledTimerId = setInterval(async () => {
            if ((await this.videoState.isEnabled()) === false) {
                return;
            }

            clearInterval(this.checkEnabledTimerId);
            this.initVideoSetting();
        }, 1000);
    }

    public async beforeUnmount(): Promise<void> {
        clearInterval(this.checkEnabledTimerId);

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
        const options: DPlayerType.Options = {
            container: this.containerElement,
            // Safari では非同期初期化後の音声付き自動再生がポリシーにより停止される。
            // 再生ボタンの明示的な操作でのみ再生を開始する。
            autoplay: UaUtil.isSafari() === false,
            live: true,
            hotkey: true,
            video: {
                url: videoSrc,
                // Safari は M3U8 をネイティブ再生できる。
                // hls.js / MSE を経由せず標準 video 要素へ直接渡すことで安定性を優先する。
                type: UaUtil.isSafari() === true ? 'normal' : 'hls',
            },
            subtitle: {
                type: 'aribb24',
            },
            pluginOptions: {
                aribb24: DPlayerUtil.createAribb24Options(),
            },
        };

        this.createPlayer(options);

        // Safari のネイティブ HLS 再生ではインライン再生属性を明示する。
        // autoplay を無効にしてから設定しているため、ユーザー操作による再生に引き継がれる。
        if (UaUtil.isSafari() === true && this.dp !== null) {
            const video = (this.dp as any).video as HTMLVideoElement;
            video.playsInline = true;
            video.setAttribute('playsinline', '');
            video.setAttribute('webkit-playsinline', '');
        }
    }
}

export default toNative(LiveHLSVideo);
</script>
