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
    private audioContext: AudioContext | null = null;
    private audioSource: MediaElementAudioSourceNode | null = null;
    private audioSplitter: ChannelSplitterNode | null = null;
    private audioMerger: ChannelMergerNode | null = null;

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
        this.destroyNativeAudioTrackSwitch();
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
        void this.setupNativeAudioTrackSwitch();
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
    private async setupNativeAudioTrackSwitch(): Promise<void> {
        const video = (this.dp as any)?.video as (HTMLVideoElement & { audioTracks?: any }) | undefined;
        const audioTracks = video?.audioTracks;
        if (typeof audioTracks !== 'undefined' && audioTracks !== null && audioTracks.length >= 2) {
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
            return;
        }

        if (video === undefined || this.videoFileId === null) {
            return;
        }

        try {
            const tracks = await this.videoApiModel.getAudioTracks(this.videoFileId);
            if (tracks.length < 2 || tracks.some(track => track.isDualMono !== true) === true) {
                return;
            }
            if (NormalVideo.getAudioContextConstructor() === null) {
                // Web Audio が使えない環境では切替 UI を出さない
                return;
            }

            this.setupAudioTrackSwitch({
                tracks: tracks,
                current: 'main',
                onSelect: async selected => {
                    await this.selectDualMonoAudioTrack(selected);
                },
            });
        } catch (err) {
            // 音声トラック API の失敗は通常再生を妨げない
            console.error(err);
            this.destroyNativeAudioTrackSwitch();
        }
    }

    /**
     * この環境で使える AudioContext のコンストラクタを返す
     * @return typeof AudioContext | null 使えない場合は null
     */
    private static getAudioContextConstructor(): typeof AudioContext | null {
        const ctor =
            window.AudioContext ??
            (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

        return typeof ctor === 'undefined' ? null : ctor;
    }

    /**
     * デュアルモノラル用の Web Audio グラフを生成する
     *
     * **再生開始時ではなく、音声を切り替えるユーザー操作の中で初めて生成する。**
     * `createMediaElementSource()` を呼ぶと以後その要素の音は Web Audio を通るようになるため、
     * 自動再生制限で AudioContext が suspended のまま生成すると、切替を使わない利用者まで無音になる
     * @param video: HTMLVideoElement
     * @return boolean 生成できた (または生成済みの) 場合 true
     */
    private setupDualMonoAudioGraph(video: HTMLVideoElement): boolean {
        if (this.audioContext !== null) {
            return true;
        }

        try {
            const AudioContextConstructor = NormalVideo.getAudioContextConstructor();
            if (AudioContextConstructor === null) {
                return false;
            }

            const context = new AudioContextConstructor();
            const source = context.createMediaElementSource(video);
            const splitter = context.createChannelSplitter(2);
            const merger = context.createChannelMerger(2);
            source.connect(context.destination);
            this.audioContext = context;
            this.audioSource = source;
            this.audioSplitter = splitter;
            this.audioMerger = merger;

            return true;
        } catch (err) {
            console.error(err);
            this.destroyNativeAudioTrackSwitch();

            return false;
        }
    }

    /**
     * Web Audio で主音声・副音声を切り替える
     * @param selected: apid.AudioTrackSpecifier
     * @return Promise<void>
     */
    private async selectDualMonoAudioTrack(selected: apid.AudioTrackSpecifier): Promise<void> {
        const video = (this.dp as any)?.video as HTMLVideoElement | undefined;
        if (typeof video === 'undefined') {
            return;
        }

        // 主音声のままならグラフを作る必要が無い (音は素通しでよい)
        if (selected !== 'sub' && this.audioContext === null) {
            return;
        }

        if (this.setupDualMonoAudioGraph(video) === false) {
            return;
        }

        if (
            this.audioContext === null ||
            this.audioSource === null ||
            this.audioSplitter === null ||
            this.audioMerger === null
        ) {
            return;
        }

        await this.audioContext.resume();
        this.audioSource.disconnect();
        this.audioSplitter.disconnect();
        this.audioMerger.disconnect();
        if (selected === 'sub') {
            this.audioSource.connect(this.audioSplitter);
            this.audioSplitter.connect(this.audioMerger, 1, 0);
            this.audioSplitter.connect(this.audioMerger, 1, 1);
            this.audioMerger.connect(this.audioContext.destination);
        } else {
            // main は元のステレオを維持。通常のステレオ放送をモノラル化しない。
            this.audioSource.connect(this.audioContext.destination);
        }
    }

    /**
     * Web Audio の後片付け
     */
    private destroyNativeAudioTrackSwitch(): void {
        try {
            this.audioSource?.disconnect();
            this.audioSplitter?.disconnect();
            this.audioMerger?.disconnect();
            void this.audioContext?.close();
        } catch (err) {
            console.error(err);
        }
        this.audioContext = null;
        this.audioSource = null;
        this.audioSplitter = null;
        this.audioMerger = null;
    }
}

export default toNative(NormalVideo);
</script>
