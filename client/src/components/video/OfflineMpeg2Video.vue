<template>
    <div ref="container" class="dplayer-wrap"></div>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import DPlayerUtil from '@/util/DPlayerUtil';
import StreamSupportUtil from '@/util/StreamSupportUtil';
import UaUtil from '@/util/UaUtil';
import { DPlayerType } from 'dplayer';
import { Deinterlacer, supportsDeinterlace } from 'mpeg2toh264/yadif';
import { Component, Prop, toNative } from 'vue-facing-decorator';

/** Cache Storage の Range 仮想ファイルを mpeg2toh264 へ渡すプレイヤー。 */
@Component({})
class OfflineMpeg2Video extends BaseVideo {
    @Prop({ required: true })
    public videoSrc!: string;

    @Prop({ default: null })
    public jikkyoChannelId!: string | null;

    @Prop({ default: null })
    public jikkyoStartAt!: number | null;

    @Prop({ default: null })
    public jikkyoEndAt!: number | null;

    protected getJikkyoKakologOption(): { jikkyoChannelId: string; startAt: number; endAt: number } | null {
        if (this.jikkyoChannelId === null || this.jikkyoStartAt === null || this.jikkyoEndAt === null) return null;
        return { jikkyoChannelId: this.jikkyoChannelId, startAt: this.jikkyoStartAt, endAt: this.jikkyoEndAt };
    }

    public mounted(): void {
        this.containerElement = this.$refs.container as HTMLElement;
        const support = StreamSupportUtil.checkMpeg2ToH264Support();
        if (support.isSupported === false) throw new Error(support.reason ?? '非対応ブラウザーです。');
        this.initVideoSetting();
    }

    protected initVideoSetting(): void {
        if (this.containerElement === null) return;
        DPlayerUtil.setupGlobals();
        const options: DPlayerType.Options = {
            container: this.containerElement,
            autoplay: UaUtil.isSafari() === false && UaUtil.isiOS() === false,
            live: false,
            video: { url: this.videoSrc, type: 'mpeg2toh264' },
            subtitle: { type: 'aribb24' },
            pluginOptions: {
                mpeg2toh264: {
                    mediaSource: UaUtil.isSafari() === true ? 'main' : 'auto',
                    passthrough: false,
                    deinterlace: supportsDeinterlace(),
                    deinterlacer: supportsDeinterlace() ? video => new Deinterlacer(video) : undefined,
                },
                aribb24: DPlayerUtil.createAribb24Options(),
            },
        };
        this.createPlayer(options);
    }
}

export default toNative(OfflineMpeg2Video);
</script>
