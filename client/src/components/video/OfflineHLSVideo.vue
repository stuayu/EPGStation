<template>
    <div ref="container" class="dplayer-wrap"></div>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import DPlayerUtil from '@/util/DPlayerUtil';
import HlsAudioTrackUtil from '@/util/HlsAudioTrackUtil';
import { DPlayerType } from 'dplayer';
import * as apid from '../../../../api';
import { parseOfflineHlsAudioTracks } from '../../../../src/util/OfflineHlsUtil';
import { Component, Prop, toNative } from 'vue-facing-decorator';

@Component({})
class OfflineHLSVideo extends BaseVideo {
    // オフライン視聴画面はコメントタブに取得失敗を出すので、プレイヤー上の通知は出さない
    protected override shouldNoticeJikkyoError(): boolean {
        return false;
    }

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

    private audioTracks: apid.VideoAudioTrack[] = [];
    private currentAudioTrack: apid.AudioTrackSpecifier = 'main';

    public mounted(): void {
        this.containerElement = this.$refs.container as HTMLElement;
        this.initVideoSetting();
        void this.loadAudioTracks();
    }

    protected initVideoSetting(): void {
        if (this.containerElement === null) return;
        DPlayerUtil.setupGlobals();
        const options: DPlayerType.Options = {
            container: this.containerElement,
            autoplay: true,
            live: false,
            video: { url: this.videoSrc, type: 'hls' },
            pluginOptions: {
                // Offline は保存済み VOD。複数音声 master を LL-HLS として扱わせない。
                hls: { lowLatencyMode: false, startPosition: 0 } as any,
            },
        };
        this.createPlayer(options);
    }

    /** 保存済み master から音声 rendition を読み、DPlayer の音声メニューへ接続する。 */
    private async loadAudioTracks(): Promise<void> {
        try {
            const response = await fetch(this.videoSrc, { cache: 'no-store' });
            if (response.ok === false) return;
            this.audioTracks = parseOfflineHlsAudioTracks(await response.text()).map(track => track as apid.VideoAudioTrack);
            this.setupAudioTrackSwitch({
                tracks: this.audioTracks,
                current: this.currentAudioTrack,
                onSelect: async track => {
                    const switched = await HlsAudioTrackUtil.switchAudioTrack(this.dp as any, track);
                    if (switched === false) throw new Error('OfflineAudioTrackSwitchUnavailable');
                    this.currentAudioTrack = track;
                    this.updateAudioTrackDiagnostic();
                },
            });
            this.updateAudioTrackDiagnostic();
        } catch (err) {
            // 音声一覧を読めなくても主音声の再生は継続する。
            console.error('offline audio track setup error', err);
        }
    }

    /** 実際に選択された hls.js / native HLS のトラック番号を検証用に公開する。 */
    private updateAudioTrackDiagnostic(): void {
        const hls = (this.dp as any)?.plugins?.hls;
        const hlsIndex = typeof hls?.audioTrack === 'number' ? hls.audioTrack : null;
        const nativeTracks = (this.dp as any)?.video?.audioTracks;
        const nativeIndex =
            hlsIndex === null && nativeTracks !== undefined && nativeTracks !== null
                ? Array.from(nativeTracks as ArrayLike<{ enabled: boolean }>).findIndex(track => track.enabled === true)
                : -1;
        const index = hlsIndex !== null ? hlsIndex : nativeIndex;
        if (index >= 0) this.containerElement?.setAttribute('data-epgstation-audio-track', index.toString(10));
    }
}

export default toNative(OfflineHLSVideo);
</script>
