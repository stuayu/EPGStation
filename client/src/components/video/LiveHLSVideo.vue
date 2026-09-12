<template>
    <div ref="container" class="dplayer-wrap"></div>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import container from '@/model/ModelContainer';
import IChannelsApiModel from '@/model/api/channels/IChannelsApiModel';
import ILiveHLSVideoState from '@/model/state/onair/ILiveHLSVideoState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import DPlayerUtil from '@/util/DPlayerUtil';
import HlsAudioTrackUtil from '@/util/HlsAudioTrackUtil';
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

    @Prop({ default: () => [] })
    public playbackProfiles!: apid.PlaybackProfile[];

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
    private currentAudioTrack: apid.AudioTrackSpecifier = 'main'; // 再生中の音声トラック
    private channelsApiModel: IChannelsApiModel = container.get<IChannelsApiModel>('IChannelsApiModel');
    private audioTracks: apid.VideoAudioTrack[] = []; // 放送中番組から取得した音声トラック一覧

    public async mounted(): Promise<void> {
        this.containerElement = this.$refs.container as HTMLElement;

        this.qualityNames = StreamQualityUtil.getLiveModeNames('hls');
        this.currentMode = StreamQualityUtil.normalizeMode(this.qualityNames, this.mode);

        // 放送中番組の音声 ES から選べる音声トラックを求める (取れなくても再生は続ける)
        this.audioTracks = await this.channelsApiModel.getLiveAudioTracks(this.channelId).catch(err => {
            console.error(err);

            return [];
        });

        // HLS stream 開始
        await this.videoState
            .start(this.channelId, this.currentMode, this.resolveStreamAudioTrack(this.currentAudioTrack))
            .catch(err => {
                console.error(err);
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
                // サーバーは LL-HLS (#EXT-X-PART / ブロッキングプレイリスト要求) で配信する。
                // パート長 = config.yml の cmd の -g (GOP) で決まる (既定 15 フレーム ≒ 0.5 秒) で、
                // 2 パート = 1 セグメントになる
                //
                // lowLatencyMode を有効にすると hls.js は #EXT-X-PART を読んでパート単位で取得し、
                // _HLS_msn / _HLS_part 付きのブロッキング要求でプレイリストを更新する。
                // 同時に LatencyController が有効になり、ライブエッジとの乖離が 50ms を超えると
                // playbackRate を書き換えて追いつき再生を試みる。この判定は非常に高頻度
                // (timeupdate は数百ms〜毎フレーム相当で発火) なため、配信ジッタだけで常時発火して
                // 再生速度の微振動 = 「ずっとかくつく」症状になることがある。
                // maxLiveSyncPlaybackRate: 1 で速度書き換えだけを止め、パート取得の利点は残す
                hls: {
                    lowLatencyMode: true,
                    // ライブエッジからの同期距離。1 秒セグメント × 3 ≒ 3 秒
                    liveSyncDurationCount: 3,
                    liveMaxLatencyDurationCount: 10,
                    // 追いつき再生 (playbackRate の書き換え) は無効にする
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
        this.setPlaybackProfiles(this.playbackProfiles, 'hls');
        this.setupLiveAudioTrackSwitch();

        // 画質切替時はサーバー側のストリームを作り直してから url を差し替える
        this.setupQualitySwitch({
            resolveUrl: mode => this.restartStream(mode),
            onSwitched: mode => {
                this.currentMode = mode;
            },
            onPlaybackReady: () => {
                if (HlsAudioTrackUtil.isSecondaryAudioTrack(this.currentAudioTrack) === true) {
                    void HlsAudioTrackUtil.switchAudioTrack(this.dp as any, this.currentAudioTrack);
                }
                void this.videoState.stopPreviousStream().catch(err => console.error(err));
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
        try {
            await this.videoState.start(this.channelId, mode, this.resolveStreamAudioTrack(this.currentAudioTrack));
            await this.waitForEnabled();
        } catch (err) {
            // 切替前のストリームは再生継続用に残し、新しく作ったストリームだけ回収する。
            await this.videoState.stopCurrentStream().catch(cleanupErr => console.error(cleanupErr));
            throw err;
        }

        const streamId = this.videoState.getStreamId();
        if (streamId === null) {
            throw new Error('StreamIdIsNull');
        }

        return `./streamfiles/stream${streamId}.m3u8`;
    }

    /**
     * DPlayer の設定 > 音声パネルへ主音声・副音声の切替を組み込む
     *
     * ライブは録画のように ffprobe をかけられないため、放送中番組の音声 ES 情報
     * (`GET /api/channels/{channelId}/audio-tracks`) から一覧を作る。
     * 番組情報が取れない放送局のために、空だった場合は主音声・副音声の 2 択へ落とす
     * (ステレオ放送で副音声を選んでも右チャンネルが両耳に出るだけで再生は続く)
     *
     * **embeddedAudioSwitch.hls が true の配信は主音声・副音声の両方が同じストリームに
     * 音声レンディションとして入っている** (サーバーが `audioTrack=all` を受けてマスタープレイリストを返す)。
     * その場合はストリームを作り直さず、hls.js / ネイティブ HLS のレンディション切替だけで済ませる
     */
    private setupLiveAudioTrackSwitch(): void {
        this.setupAudioTrackSwitch({
            tracks: this.audioTracks.length > 0 ? this.audioTracks : LiveHLSVideo.FALLBACK_AUDIO_TRACKS,
            current: this.currentAudioTrack,
            onSelect: async track => {
                if (this.isEmbeddedAudioSwitchMode(this.currentMode) === true) {
                    const switched = await HlsAudioTrackUtil.switchAudioTrack(this.dp as any, track);
                    if (switched === true) {
                        this.currentAudioTrack = track;

                        return;
                    }
                    // レンディションが揃っていない場合は下の再接続方式へフォールバックする
                }

                await this.videoState.stop();
                await this.videoState.start(this.channelId, this.currentMode, this.resolveStreamAudioTrack(track));
                await this.waitForEnabled();
                this.currentAudioTrack = track;
                this.initVideoSetting();
            },
        });
    }

    /**
     * 指定した mode (hls の再生プロファイル) が主音声・副音声を同時に配信できるか
     * (embeddedAudioSwitch.hls === true か) を返す
     * @param mode: number
     * @return boolean
     */
    private isEmbeddedAudioSwitchMode(mode: number): boolean {
        const profile = this.playbackProfiles.find(item => item.modes?.hls === mode);

        return profile?.embeddedAudioSwitch?.hls === true;
    }

    /**
     * ストリーム開始 API へ渡す音声トラック指定子を返す
     *
     * **主音声のときは embeddedAudioSwitch が分からなくても 'all' で開く**。playbackProfiles は
     * プレイヤー生成後に非同期で届くため、最初のストリームを開始する時点ではまだ空のことが多い。
     * サーバーは tsreadex を通さない cmd では 'all' を 'main' として扱うので、どちらの構成でも安全
     * @param track: apid.AudioTrackSpecifier
     * @return apid.AudioTrackSpecifier
     */
    private resolveStreamAudioTrack(track: apid.AudioTrackSpecifier): apid.AudioTrackSpecifier {
        return HlsAudioTrackUtil.isSecondaryAudioTrack(track) === false ||
            this.isEmbeddedAudioSwitchMode(this.currentMode) === true
            ? 'all'
            : track;
    }

    /**
     * ストリームが有効になるまで待つ
     * @return Promise<void>
     */
    private waitForEnabled(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const startedAt = Date.now();
            let timerId: ReturnType<typeof setTimeout> | undefined;
            let settled = false;
            const check = async (): Promise<void> => {
                try {
                    if ((await this.videoState.isEnabled()) === true) {
                        settled = true;
                        if (typeof timerId !== 'undefined') clearTimeout(timerId);
                        resolve();
                        return;
                    }
                    if (Date.now() - startedAt >= LiveHLSVideo.WAIT_ENABLED_LIMIT * 1000) {
                        settled = true;
                        reject(new Error('StreamIsNotEnabled'));
                        return;
                    }
                    if (settled === false) timerId = setTimeout(() => void check(), LiveHLSVideo.WAIT_ENABLED_INTERVAL_MS);
                } catch (err) {
                    settled = true;
                    reject(err);
                }
            };
            void check();
        });
    }
}

namespace LiveHLSVideo {
    export const WAIT_ENABLED_LIMIT = 30; // ストリームが有効になるまで待つ最大秒数
    export const WAIT_ENABLED_INTERVAL_MS = 200;
}

namespace LiveHLSVideo {
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

export default toNative(LiveHLSVideo);
</script>
