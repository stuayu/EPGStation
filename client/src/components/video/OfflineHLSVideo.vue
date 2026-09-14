<template>
    <div ref="container" class="dplayer-wrap"></div>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import DPlayerUtil from '@/util/DPlayerUtil';
import { DPlayerType } from 'dplayer';
import { Component, Prop, toNative } from 'vue-facing-decorator';

@Component({})
class OfflineHLSVideo extends BaseVideo {
    @Prop({ required: true })
    public videoSrc!: string;

    public mounted(): void {
        this.containerElement = this.$refs.container as HTMLElement;
        this.initVideoSetting();
    }

    protected initVideoSetting(): void {
        if (this.containerElement === null) return;
        DPlayerUtil.setupGlobals();
        const options: DPlayerType.Options = {
            container: this.containerElement,
            autoplay: true,
            live: false,
            video: { url: this.videoSrc, type: 'hls' },
        };
        this.createPlayer(options);
    }
}

export default toNative(OfflineHLSVideo);
</script>
