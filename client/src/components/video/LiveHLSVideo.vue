<template>
    <div ref="container" class="dplayer-wrap"></div>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import container from '@/model/ModelContainer';
import ILiveHLSVideoState from '@/model/state/onair/ILiveHLSVideoState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import DPlayerUtil from '@/util/DPlayerUtil';
import { DPlayerType } from 'dplayer';
import { Component, Prop } from 'vue-facing-decorator';
import * as apid from '../../../../api';

@Component({})
export default class LiveHLSVideo extends BaseVideo {
    @Prop({ required: true })
    public channelId!: apid.ChannelId;

    @Prop({ required: true })
    public mode!: number;

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
            autoplay: true,
            live: true,
            hotkey: true,
            video: {
                url: videoSrc,
                type: 'hls',
            },
            subtitle: {
                type: 'aribb24',
            },
            pluginOptions: {
                aribb24: DPlayerUtil.createAribb24Options(),
            },
        };

        this.createPlayer(options);
    }
}
</script>
