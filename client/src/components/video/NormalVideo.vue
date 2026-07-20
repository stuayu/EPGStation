<template>
    <div ref="container" class="dplayer-wrap"></div>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import DPlayerUtil from '@/util/DPlayerUtil';
import { DPlayerType } from 'dplayer';
import { Component, Prop, toNative } from 'vue-facing-decorator';

@Component({})
class NormalVideo extends BaseVideo {
    @Prop({ required: true })
    public videoSrc!: string;

    @Prop({ default: null })
    public jikkyoChannelId!: string | null;

    @Prop({ default: null })
    public jikkyoStartAt!: number | null;

    @Prop({ default: null })
    public jikkyoEndAt!: number | null;

    public mounted(): void {
        super.mounted();
    }

    /**
     * ニコニコ実況の実況チャンネル ID を返す
     */
    protected getJikkyoChannelId(): string | null {
        // 録画再生ではライブ接続ではなく過去ログ API を使用する
        if (this.jikkyoStartAt !== null && this.jikkyoEndAt !== null) {
            return null;
        }
        return this.jikkyoChannelId;
    }

    /**
     * 録画再生時のニコニコ実況過去ログ取得情報を返す
     */
    protected getJikkyoKakologOption(): { jikkyoChannelId: string; startAt: number; endAt: number } | null {
        if (this.jikkyoChannelId === null || this.jikkyoStartAt === null || this.jikkyoEndAt === null) {
            return null;
        }
        return {
            jikkyoChannelId: this.jikkyoChannelId,
            startAt: this.jikkyoStartAt,
            endAt: this.jikkyoEndAt,
        };
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

export default toNative(NormalVideo);
</script>
