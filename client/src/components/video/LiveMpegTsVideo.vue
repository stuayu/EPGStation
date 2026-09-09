<template>
    <div ref="container" class="dplayer-wrap"></div>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import IChannelsApiModel from '@/model/api/channels/IChannelsApiModel';
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import DPlayerUtil from '@/util/DPlayerUtil';
import StreamQualityUtil from '@/util/StreamQualityUtil';
import StreamSupportUtil from '@/util/StreamSupportUtil';
import UaUtil from '@/util/UaUtil';
import Util from '@/util/Util';
import { DPlayerType } from 'dplayer';
import { Component, Prop, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../api';

@Component({})
class LiveMpegTsVideo extends BaseVideo {
    @Prop({ required: true })
    public videoSrc!: string;

    @Prop({ default: null })
    public channelId!: apid.ChannelId | null;

    @Prop({ default: 0 })
    public mode!: number;

    @Prop({ default: null })
    public jikkyoChannelId!: string | null;

    @Prop({ default: () => [] })
    public playbackProfiles!: apid.PlaybackProfile[];

    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private channelsApiModel: IChannelsApiModel = container.get<IChannelsApiModel>('IChannelsApiModel');
    private audioTracks: apid.VideoAudioTrack[] = []; // 放送中番組から取得した音声トラック一覧
    private currentMode: number = 0; // 再生中の視聴設定 (画質切替で更新される)
    private currentAudioTrack: apid.AudioTrackSpecifier = 'main'; // 再生中の音声トラック

    public mounted(): void {
        this.currentMode = this.mode;
        super.mounted();

        // 放送中番組の音声 ES から選べる音声トラックを求める (取れなくても再生は続ける)
        if (this.channelId !== null) {
            this.channelsApiModel
                .getLiveAudioTracks(this.channelId)
                .then(tracks => {
                    this.audioTracks = tracks;
                    this.setupLiveAudioTrackSwitch();
                })
                .catch(err => {
                    console.error(err);
                    this.setupLiveAudioTrackSwitch();
                });
        }
    }

    /**
     * ニコニコ実況の実況チャンネル ID を返す
     */
    protected getJikkyoChannelId(): string | null {
        return this.jikkyoChannelId;
    }

    /**
     * 視聴中の放送局 id を返す
     * 実況コメントの遅延補正で、配信中の映像の放送時刻を引くのに使う
     */
    protected getChannelId(): apid.ChannelId | null {
        return this.channelId;
    }

    /**
     * データ放送 (BML) の接続パラメータ
     */
    public getDataBroadcastingParam() {
        return this.channelId === null ? null : { type: 'epgStationLive' as const, channelId: this.channelId };
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

        // 対応しているか確認 (MMS 対応・iOS 26 以降のホーム画面 Web App 等の既知不具合も含む)
        const m2tsllSupport = StreamSupportUtil.checkM2TSLLSupport();
        if (m2tsllSupport.isSupported === false) {
            this.snackbarState.open({
                color: 'error',
                text: m2tsllSupport.reason ?? '非対応ブラウザーです。',
            });

            throw new Error('UnsupportedBrowser');
        }

        DPlayerUtil.setupGlobals();

        // プレイヤー上から解像度 (エンコード設定) を動的に切り替えられるよう
        // config の m2tsll 設定一覧から DPlayer の quality リストを生成する
        const qualities = this.createQualityList();

        const options: DPlayerType.Options = {
            container: this.containerElement,
            // Safari / iOS では音声付き自動再生がポリシーにより停止されるため、
            // 再生ボタンの明示的な操作でのみ再生を開始する
            autoplay: UaUtil.isSafari() === false && UaUtil.isiOS() === false,
            live: true,
            hotkey: true,
            video:
                qualities.length > 0
                    ? ({
                          quality: qualities,
                          defaultQuality: this.mode < qualities.length ? this.mode : 0,
                      } as DPlayerType.Options['video'])
                    : {
                          url: this.videoSrc,
                          type: 'mpegts',
                      },
            subtitle: {
                type: 'aribb24',
            },
            pluginOptions: {
                mpegts: {
                    config: {
                        enableWorker: true,
                        // 低遅延: 再生位置が遅延したら自動で追いかける
                        liveBufferLatencyChasing: true,
                        liveBufferLatencyMinRemain: 0.5,
                        liveBufferLatencyMaxLatency: 2.0,
                        // 長時間視聴でのメモリ増加対策: 再生済みバッファを自動解放する
                        autoCleanupSourceBuffer: true,
                        autoCleanupMaxBackwardDuration: 30,
                        autoCleanupMinBackwardDuration: 15,
                    },
                },
                aribb24: DPlayerUtil.createAribb24Options(),
            },
        };

        this.createPlayer(options);
        this.setPlaybackProfiles(this.playbackProfiles, 'm2tsll');
        this.setupLiveAudioTrackSwitch();
        this.setupQualitySwitch({
            resolveUrl: async mode => this.createStreamUrl(mode, this.currentAudioTrack),
            onSwitched: mode => {
                this.currentMode = mode;
            },
        });
    }

    /**
     * DPlayer の設定 > 音声パネルへ主音声・副音声の切替を組み込む
     *
     * m2tsll はサーバー側で音声を選んで配信するため、切替は画質切替と同じく
     * 「audioTrack を変えた url へ差し替えて読み直す」形で行う。
     * 番組情報が取れない放送局のために、一覧が空なら主音声・副音声の 2 択へ落とす
     */
    private setupLiveAudioTrackSwitch(): void {
        this.setupAudioTrackSwitch({
            tracks: this.audioTracks.length > 0 ? this.audioTracks : LiveMpegTsVideo.FALLBACK_AUDIO_TRACKS,
            current: this.currentAudioTrack,
            onSelect: async track => {
                const dp = this.dp as any;
                if (dp === null) {
                    return;
                }

                this.currentAudioTrack = track;
                // 画質切替と同じ経路で読み直す (音量・字幕表示などの復元も共通処理に任せる)
                dp.switchQuality(this.currentMode);
            },
        });
    }

    /**
     * 配信 url を組み立てる
     * @param mode: number 視聴設定
     * @param audioTrack: apid.AudioTrackSpecifier 音声トラック
     * @return string
     */
    private createStreamUrl(mode: number, audioTrack: apid.AudioTrackSpecifier): string {
        return `${window.location.origin}${Util.getSubDirectory()}/api/streams/live/${this.channelId}/m2tsll?mode=${mode}&audioTrack=${encodeURIComponent(audioTrack)}`;
    }

    /**
     * config の m2tsll 設定から DPlayer の quality リストを生成する
     * @return DPlayerType.VideoQuality[]
     */
    private createQualityList(): DPlayerType.VideoQuality[] {
        if (this.channelId === null) {
            return [];
        }

        return StreamQualityUtil.getLiveModeNames('m2tsll').map((name, mode) => {
            return {
                name: name,
                url: this.createStreamUrl(mode, this.currentAudioTrack),
                type: 'mpegts',
            };
        });
    }

    /**
     * 動画の長さを返す (秒)
     * @return number
     */
    public getDuration(): number {
        return 0;
    }

    /**
     * 動画の現在再生位置を返す (秒)
     * @return number
     */
    public getCurrentTime(): number {
        return 0;
    }

    /**
     * 再生位置設定
     * @param time: number (秒)
     */
    public setCurrentTime(time: number): void {
        return;
    }
}

namespace LiveMpegTsVideo {
    // 番組情報から音声トラックを求められなかったときに出す 2 択 (二か国語放送のデュアルモノラル前提)
    export const FALLBACK_AUDIO_TRACKS: apid.VideoAudioTrack[] = [
        { track: 'main', name: '主音声', streamIndex: 0, isDualMono: true, codec: null, language: null, channels: null },
        {
            track: 'sub',
            name: '副音声 (デュアルモノラル)',
            streamIndex: 0,
            isDualMono: true,
            codec: null,
            language: null,
            channels: null,
        },
    ];
}

export default toNative(LiveMpegTsVideo);
</script>
