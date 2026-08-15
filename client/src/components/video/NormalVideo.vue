<template>
    <div ref="container" class="dplayer-wrap"></div>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import container from '@/model/ModelContainer';
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import DPlayerUtil from '@/util/DPlayerUtil';
import { DPlayerType } from 'dplayer';
import { Component, Prop, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../api';

@Component({})
class NormalVideo extends BaseVideo {
    @Prop({ required: true })
    public videoSrc!: string;

    @Prop({ default: null })
    public videoFileId!: apid.VideoFileId | null;

    @Prop({ default: null })
    public jikkyoChannelId!: string | null;

    @Prop({ default: null })
    public jikkyoStartAt!: number | null;

    @Prop({ default: null })
    public jikkyoEndAt!: number | null;

    private videoApiModel: IVideoApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    public mounted(): void {
        this.containerElement = this.$refs.container as HTMLElement;

        this.$nextTick(async () => {
            if (this.videoFileId !== null) {
                await this.fetchChapters(this.videoFileId);
                void this.fetchVideoFileSizeForDataBroadcasting(this.videoFileId);
            }

            this.initVideoSetting();
        });
    }

    /**
     * 録画ファイルのチャプターを取得する
     * 取得に失敗しても再生自体は続けられるため、エラーはログに残すだけにする
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    private async fetchChapters(videoFileId: apid.VideoFileId): Promise<void> {
        try {
            this.setChapters(await this.videoApiModel.getChapters(videoFileId));
        } catch (err) {
            console.error(err);
        }
    }

    /**
     * データ放送 (BML) の接続パラメータ
     */
    public getDataBroadcastingParam() {
        return this.videoFileId === null ? null : this.buildRecordedDataBroadcastingParam(this.videoFileId);
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

        // ファイルを直接再生するため、動画長は video 要素のメタデータが読めるまで分からない。
        // チャプターのマーカーは DPlayer 生成時にしか渡せないので、メタデータ取得後に自前で描き足す
        this.applyChapterMarkersAfterLoad();

        // 複数音声トラックを持つファイルはブラウザ側で切り替えられる (サーバー再エンコード不要)
        this.setupNativeAudioTrackSwitch();
    }

    /**
     * video 要素のメタデータ (動画長) が読めた時点でチャプターマーカーを描き足す
     */
    private applyChapterMarkersAfterLoad(): void {
        const dp = this.dp as any;
        if (dp === null || this.getChapters().length === 0) {
            return;
        }

        const apply = (): void => {
            const duration = dp.video?.duration;
            if (typeof duration !== 'number' || isFinite(duration) === false || duration <= 0) {
                return;
            }

            for (const chapter of this.getChapters()) {
                if (chapter.startAt < 0 || chapter.startAt >= duration) {
                    continue;
                }

                const marker = document.createElement('div');
                marker.className = 'dplayer-highlight';
                marker.style.left = `${(chapter.startAt / duration) * 100}%`;
                const label = document.createElement('span');
                label.className = 'dplayer-highlight-text';
                label.textContent = chapter.title ?? 'チャプター';
                marker.appendChild(label);
                dp.template?.playedBarWrap?.appendChild(marker);
            }
        };

        if (dp.video?.readyState >= 1) {
            apply();
        } else {
            dp.on('loadedmetadata', apply);
        }
    }

    /**
     * 複数音声トラックを持つファイルの音声切替を DPlayer の設定パネルへ組み込む
     *
     * ファイルを直接再生する場合は video 要素の audioTracks で切り替えられるため、
     * サーバー側でストリームを作り直す必要がない (切替は即座に反映される)。
     * audioTracks は Safari と一部の Chromium でのみ利用でき、
     * 使えないブラウザでは切替 UI を出さない
     */
    private setupNativeAudioTrackSwitch(): void {
        const video = (this.dp as any)?.video as (HTMLVideoElement & { audioTracks?: any }) | undefined;
        const audioTracks = video?.audioTracks;
        if (typeof audioTracks === 'undefined' || audioTracks === null || audioTracks.length < 2) {
            return;
        }

        const tracks: apid.VideoAudioTrack[] = [];
        let current: apid.AudioTrackSpecifier = '0';
        for (let i = 0; i < audioTracks.length; i++) {
            const track = audioTracks[i];
            tracks.push({
                track: i.toString(10),
                name: track.label !== '' ? track.label : i === 0 ? '主音声' : `音声 ${i + 1}`,
                streamIndex: i,
                isDualMono: false,
                codec: null,
                language: typeof track.language === 'string' && track.language !== '' ? track.language : null,
                channels: null,
            });
            if (track.enabled === true) {
                current = i.toString(10);
            }
        }

        this.setupAudioTrackSwitch({
            tracks: tracks,
            current: current,
            onSelect: async selected => {
                const index = parseInt(selected, 10);
                for (let i = 0; i < audioTracks.length; i++) {
                    audioTracks[i].enabled = i === index;
                }
            },
        });
    }
}

export default toNative(NormalVideo);
</script>
