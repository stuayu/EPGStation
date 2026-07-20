<template>
    <div ref="container" class="dplayer-wrap"></div>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import DPlayerUtil from '@/util/DPlayerUtil';
import { DPlayerType } from 'dplayer';
import { Component, Prop } from 'vue-facing-decorator';

@Component({})
export default class NormalVideo extends BaseVideo {
    @Prop({ required: true })
    public videoSrc!: string;

    public mounted(): void {
        super.mounted();
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

        DPlayerUtil.setupGlobals();

        const options: DPlayerType.Options = {
            container: this.containerElement,
            autoplay: true,
            live: false,
            hotkey: true,
            video: {
                url: this.videoSrc,
                type: 'normal',
            },
        };

        this.createPlayer(options);
    }
}
</script>
