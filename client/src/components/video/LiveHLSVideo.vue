<template>
    <div ref="container" class="dplayer-wrap"></div>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import container from '@/model/ModelContainer';
import ILiveHLSVideoState from '@/model/state/onair/ILiveHLSVideoState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import DPlayerUtil from '@/util/DPlayerUtil';
import StreamQualityUtil from '@/util/StreamQualityUtil';
import UaUtil from '@/util/UaUtil';
import { DPlayerType } from 'dplayer';
import { Component, Prop, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../api';

@Component({})
class LiveHLSVideo extends BaseVideo {
    @Prop({ required: true })
    public channelId!: apid.ChannelId;

    @Prop({ required: true })
    public mode!: number;

    @Prop({ default: null })
    public jikkyoChannelId!: string | null;

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
        return { type: 'epgStationLive' as const, channelId: this.channelId };
    }

    private videoState: ILiveHLSVideoState = container.get<ILiveHLSVideoState>('ILiveHLSVideoState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private checkEnabledTimerId: ReturnType<typeof setTimeout> | undefined;
    private qualityNames: string[] = []; // config の hls 視聴設定名一覧
    private currentMode: number = 0; // 再生中の視聴設定 (画質切替で更新される)

    public async mounted(): Promise<void> {
        this.containerElement = this.$refs.container as HTMLElement;

        this.qualityNames = StreamQualityUtil.getLiveModeNames('hls');
        this.currentMode = StreamQualityUtil.normalizeMode(this.qualityNames, this.mode);

        // HLS stream 開始
        await this.videoState.start(this.channelId, this.currentMode).catch(err => {
            this.snackbarState.open({
                color: 'error',
                text: 'ストリーム開始に失敗',
            });
        });

        // ストリームが有効になるまで待つ
        this.checkEnabledTimerId = setInterval(async () => {
            if ((await this.videoState.isEnabled()) === false) {
                return;
            }

            clearInterval(this.checkEnabledTimerId);
            this.initVideoSetting();
        }, 1000);
    }

    public async beforeUnmount(): Promise<void> {
        clearInterval(this.checkEnabledTimerId);

        super.beforeUnmount();

        await this.videoState.stop().catch(err => {
            this.snackbarState.open({
                color: 'error',
                text: 'ストリーム停止に失敗',
            });
        });
    }

    /**
     * video 再生初期設定
     */
    protected initVideoSetting(): void {
        if (this.containerElement === null) {
            return;
        }

        const streamId = this.videoState.getStreamId();
        if (streamId === null) {
            this.snackbarState.open({
                color: 'error',
                text: 'ストリーム id 取得に失敗',
            });
            throw new Error('StreamIdIsNull');
        }

        DPlayerUtil.setupGlobals();

        const videoSrc = `./streamfiles/stream${streamId}.m3u8`;
        // Safari も含めて 'hls' を指定する。
        // Safari では DPlayerUtil.setupGlobals() が window.Hls.isSupported() を false にしているため、
        // DPlayer は hls.js / MSE を経由せず標準 video 要素へ直接渡すネイティブ HLS 再生を選ぶ。
        // type に 'normal' を渡すと DPlayer が ARIB 字幕 (aribb24.js) を初期化しないため使わない。
        const videoType = 'hls';

        // プレイヤー上から画質 (エンコード設定) を切り替えられるよう
        // config の hls 設定一覧から DPlayer の quality リストを生成する
        const qualities = StreamQualityUtil.createQualityList(this.qualityNames, videoSrc, videoType);

        const options: DPlayerType.Options = {
            container: this.containerElement,
            // Safari では非同期初期化後の音声付き自動再生がポリシーにより停止される。
            // 再生ボタンの明示的な操作でのみ再生を開始する。
            autoplay: UaUtil.isSafari() === false,
            live: true,
            hotkey: true,
            video:
                qualities.length > 0
                    ? ({
                          quality: qualities,
                          defaultQuality: this.currentMode,
                      } as DPlayerType.Options['video'])
                    : {
                          url: videoSrc,
                          type: videoType,
                      },
            subtitle: {
                type: 'aribb24',
            },
            pluginOptions: {
                // hls.js 使用時 (Safari 以外) の低遅延・バッファチューニング
                // セグメント長は config.yml の cmd の -g (GOP) で決まる (QSV は現在 24 フレーム
                // ≒ 0.8 秒。QSV エンコードが 15 フレーム ≒ 0.5 秒だと負荷が厳しかったため延長した)
                //
                // lowLatencyMode は意図的に false にしている。true にすると hls.js の
                // LatencyController が video の timeupdate イベントのたびに
                // (ライブエッジとの距離 - targetLatency) を計算し、50ms を超えて乖離すると
                // media.playbackRate を書き換えて追いつき再生を試みる。この判定は非常に高頻度
                // (timeupdate は数百ms〜毎フレーム相当で発火) かつ閾値が極端に狭いため、
                // 通常のセグメント配信ジッタだけで常時発火し、体感できるレベルの再生速度の
                // 微振動 = 「ずっとかくつく」症状の原因になっていた
                // (mpdecimate による実測: 189 秒の録画中に 80〜200ms の一時停止が 138 回、
                // ほぼ均等に分布して発生していたことを確認済み)。
                // このサーバーは真の LL-HLS (#EXT-X-PART) を実装していないため、
                // lowLatencyMode を有効にする本来のメリットも元々存在しない。
                hls: {
                    lowLatencyMode: false,
                    // ライブエッジからの同期距離。0.8 秒 × 4 ≒ 3.2 秒
                    liveSyncDurationCount: 4,
                    liveMaxLatencyDurationCount: 12,
                    // lowLatencyMode: false の場合 LatencyController の追いつき再生ロジック自体が
                    // 丸ごと無効化されるため実質無意味だが、意図を明示するため 1 (無効) にしておく
                    maxLiveSyncPlaybackRate: 1,
                    // セグメントが短いぶんリクエスト間隔が詰まるため、失敗時の再試行を短くする
                    fragLoadingMaxRetry: 2,
                    fragLoadingRetryDelay: 200,
                    manifestLoadingMaxRetry: 2,
                    manifestLoadingRetryDelay: 200,
                    // 長時間視聴でのメモリ増加対策
                    backBufferLength: 30,
                } as any,
                aribb24: DPlayerUtil.createAribb24Options(),
            },
        };

        this.createPlayer(options);

        // 画質切替時はサーバー側のストリームを作り直してから url を差し替える
        this.setupQualitySwitch({
            resolveUrl: mode => this.restartStream(mode),
            onSwitched: mode => {
                this.currentMode = mode;
            },
        });

        if (this.dp !== null) {
            const dp = this.dp as any;
            this.setInlinePlaybackAttributes(dp.video);

            // 画質切替では video 要素が作り直され、その直後に再生が開始される。
            // 再生前に属性を設定する必要があるため initVideo をラップする
            const originalInitVideo = dp.initVideo.bind(dp);
            dp.initVideo = (video: HTMLVideoElement, type: string): void => {
                this.setInlinePlaybackAttributes(video);
                originalInitVideo(video, type);
            };
        }
    }

    /**
     * Safari のネイティブ HLS 再生ではインライン再生属性を明示する
     * autoplay を無効にしてから設定しているため、ユーザー操作による再生に引き継がれる
     * @param video: HTMLVideoElement
     */
    private setInlinePlaybackAttributes(video: HTMLVideoElement): void {
        if (UaUtil.isSafari() === false) {
            return;
        }

        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
    }

    /**
     * 指定した mode でサーバー側の HLS ストリームを作り直し、新しい m3u8 の url を返す
     * @param mode: number
     * @return Promise<string> m3u8 の url
     */
    private async restartStream(mode: number): Promise<string> {
        await this.videoState.stop();
        await this.videoState.start(this.channelId, mode);
        await this.waitForEnabled();

        const streamId = this.videoState.getStreamId();
        if (streamId === null) {
            throw new Error('StreamIdIsNull');
        }

        return `./streamfiles/stream${streamId}.m3u8`;
    }

    /**
     * ストリームが有効になるまで待つ
     * @return Promise<void>
     */
    private waitForEnabled(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            let count = 0;
            const timerId = setInterval(async () => {
                count++;
                if ((await this.videoState.isEnabled()) === true) {
                    clearInterval(timerId);
                    resolve();

                    return;
                }

                if (count >= LiveHLSVideo.WAIT_ENABLED_LIMIT) {
                    clearInterval(timerId);
                    reject(new Error('StreamIsNotEnabled'));
                }
            }, 1000);
        });
    }
}

namespace LiveHLSVideo {
    export const WAIT_ENABLED_LIMIT = 30; // ストリームが有効になるまで待つ最大秒数
}

export default toNative(LiveHLSVideo);
</script>
