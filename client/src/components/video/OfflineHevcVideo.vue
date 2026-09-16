<template>
    <div ref="container" class="dplayer-wrap"></div>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import DPlayerUtil from '@/util/DPlayerUtil';
import StreamSupportUtil from '@/util/StreamSupportUtil';
import { DPlayerType } from 'dplayer';
import * as apid from '../../../../api';
import { createOfflineDataBroadcastingParam } from '../../../../src/util/OfflineUxUtil';
import { Component, Prop, toNative } from 'vue-facing-decorator';

/** 保存済み元 TS の HEVC を Range VOD として mpegts.js へ渡すプレイヤー。 */
@Component({})
class OfflineHevcVideo extends BaseVideo {
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    protected override shouldNoticeJikkyoError(): boolean { return false; }

    @Prop({ required: true })
    public videoSrc!: string;

    @Prop({ required: true })
    public durationSeconds!: number;

    @Prop({ default: () => [] })
    public offlineChapters!: apid.VideoChapter[];

    @Prop({ default: undefined })
    public offlineDataBroadcastingVideoFileId!: apid.VideoFileId | undefined;

    @Prop({ default: undefined })
    public offlineDataBroadcastingFileSize!: number | undefined;

    @Prop({ default: undefined })
    public offlineDataBroadcastingChunkSize!: number | undefined;

    @Prop({ default: undefined })
    public offlineDataBroadcastingStartAt!: number | undefined;

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
        this.setChapters(this.offlineChapters);
        this.setDataBroadcastingFileInfo(this.offlineDataBroadcastingFileSize ?? null, this.offlineDataBroadcastingStartAt ?? null);
        // 保存レコードには素材のビット深度が無いため、ここでは transmux 可否だけを見る。
        // 10bit HEVC は WebKit で実時間デコードできないが、それは保存前に
        // OfflineVideoDownloadDialog が候補から外して防ぐ (保存済みの分は再生を試みる)
        const support = StreamSupportUtil.checkMpegTsHevcSupport();
        if (support.isSupported === false) {
            // 例外を投げるだけだと画面が黒いままになるので、理由を画面へ出す
            this.snackbarState.open({ color: 'error', text: support.reason ?? '非対応ブラウザーです。' });
            throw new Error(support.reason ?? '非対応ブラウザーです。');
        }
        DPlayerUtil.enableMpegtsHevcPlayback();
        this.initVideoSetting();
    }

    protected override isEnabledVirtualTimeline(): boolean { return true; }

    public override getDuration(): number { return super.getDuration() || this.durationSeconds; }

    public override getDataBroadcastingParam() {
        return this.offlineDataBroadcastingVideoFileId === undefined
            ? null
            : createOfflineDataBroadcastingParam(
                  this.offlineDataBroadcastingVideoFileId,
                  this.videoSrc,
                  this.offlineDataBroadcastingFileSize ?? 0,
                  this.offlineDataBroadcastingStartAt,
                  this.offlineDataBroadcastingChunkSize,
              );
    }

    protected initVideoSetting(): void {
        if (this.containerElement === null) return;
        DPlayerUtil.setupGlobals();
        const options: DPlayerType.Options = {
            container: this.containerElement,
            autoplay: true,
            live: false,
            video: { url: this.videoSrc, type: 'mpegts' },
            subtitle: { type: 'aribb24' },
            pluginOptions: {
                mpegts: {
                    mediaDataSource: { type: 'mpegts', isLive: false },
                    config: {
                        isLive: false,
                        enableWorker: true,
                        enableStashBuffer: true,
                        stashInitialSize: 64 * 1024,
                        autoCleanupSourceBuffer: true,
                        autoCleanupMaxBackwardDuration: 30,
                        autoCleanupMinBackwardDuration: 15,
                    },
                },
                aribb24: DPlayerUtil.createAribb24Options(),
            },
        };
        this.applyChapterHighlights(options, this.durationSeconds);
        this.createPlayer(options);
    }
}

export default toNative(OfflineHevcVideo);
</script>
