<template>
    <div ref="container" class="dplayer-wrap"></div>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
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

    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    public mounted(): void {
        super.mounted();
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
                url: `${window.location.origin}${Util.getSubDirectory()}/api/streams/live/${this.channelId}/m2tsll?mode=${mode}`,
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

export default toNative(LiveMpegTsVideo);
</script>
