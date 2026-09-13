<template>
    <div ref="container" class="dplayer-wrap"></div>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import IChannelsApiModel from '@/model/api/channels/IChannelsApiModel';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
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
import ProgramAudioTrackUtil from '../../../../src/util/ProgramAudioTrackUtil';

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
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private audioTracks: apid.VideoAudioTrack[] = []; // 放送中番組から取得した音声トラック一覧
    private audioTracksKnown = false;
    private currentMode: number = 0; // 再生中の視聴設定 (画質切替で更新される)
    private currentAudioTrack: apid.AudioTrackSpecifier = 'main'; // 再生中の音声トラック
    private deferredMpegtsCleanups = new Set<() => void>();
    private audioTrackUpdateGeneration = 0;

    public mounted(): void {
        this.currentMode = this.mode;
        this.socketIoModel.onUpdateOnAirProgram(this.onUpdateOnAirProgram);
        super.mounted();

        // 放送中番組の音声 ES から選べる音声トラックを求める (取れなくても再生は続ける)
        if (this.channelId !== null) {
            const generation = ++this.audioTrackUpdateGeneration;
            this.channelsApiModel
                .getLiveAudioTracks(this.channelId)
                .then(tracks => {
                    if (generation !== this.audioTrackUpdateGeneration) return;
                    this.audioTracks = tracks;
                    this.audioTracksKnown = true;
                    this.setupLiveAudioTrackSwitch();
                })
                .catch(err => {
                    if (generation !== this.audioTrackUpdateGeneration) return;
                    console.error(err);
                    this.audioTracksKnown = false;
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
        this.socketIoModel.offUpdateOnAirProgram(this.onUpdateOnAirProgram);
        this.cleanupDeferredMpegts();
        super.beforeUnmount();
    }

    /**
     * EIT[p/f] の番組切替を受け、新番組の音声トラック一覧を反映する。
     * 選択中の ES が無くなった場合は主音声へ戻し、配信も主音声で再生成する。
     * @param payload: { channelIds: number[] }
     * @return Promise<void>
     */
    public async onUpdateOnAirProgram(payload: { channelIds: number[] }): Promise<void> {
        if (this.channelId === null || payload.channelIds.includes(this.channelId) === false) return;

        const generation = ++this.audioTrackUpdateGeneration;
        try {
            const tracks = await this.channelsApiModel.getLiveAudioTracks(this.channelId);
            if (generation !== this.audioTrackUpdateGeneration) return;

            const previous = this.currentAudioTrack;
            this.audioTracks = tracks;
            this.audioTracksKnown = true;
            const next = ProgramAudioTrackUtil.resolveCurrentTrack(tracks, previous);
            this.currentAudioTrack = next;
            this.setupLiveAudioTrackSwitch();
            if (next === previous || this.dp === null) return;

            const mpegts = (this.dp as any).plugins?.mpegts;
            if (
                this.isEmbeddedAudioSwitchMode(this.currentMode) === true &&
                typeof mpegts?.switchPrimaryAudio === 'function'
            ) {
                mpegts.switchPrimaryAudio();
            } else {
                // currentAudioTrack は先に main へ戻してから URL を再生成する。
                (this.dp as any).switchQuality(this.currentMode);
            }
        } catch (err) {
            console.error(err);
        }
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
                        // stash は無効にするとネットワークの chunk 境界で TS/PES を取りこぼしやすい。
                        // 64KiB は mpegts.js の既定値 (約 0.13 秒分、4Mbps 換算)。
                        // stash を無効化せず初期 300KiB 待ちにも戻さない挙動を明示固定する。
                        enableStashBuffer: true,
                        stashInitialSize: 64 * 1024,
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
        this.deferPreviousMpegtsDestroy();
        this.setupQualitySwitch({
            resolveUrl: async mode => this.createStreamUrl(mode, this.currentAudioTrack),
            onSwitched: mode => {
                this.currentMode = mode;
                // 画質切替 (= mpegts.js インスタンスの作り直し) の直後は選択中の副音声が失われる
                // (新インスタンスは常に主音声から始まる) ため、切替が完了してから選択を再適用する。
                // originalSwitchQuality() (dp.plugins.mpegts の再生成を含む) はこの後に同期的に
                // 呼ばれるため、マイクロタスクへ逃がして完了を待つ
                void Promise.resolve().then(() => this.reapplyEmbeddedAudioTrack(mode));
            },
            onPlaybackReady: () => this.cleanupDeferredMpegts(),
        });
        this.setupMpegtsPlaybackRecovery();
    }

    /**
     * DPlayer の mpegts.js 差し替え時、旧プレイヤーを新しい video の canplay まで保持する。
     * DPlayer 標準は initMSE() の冒頭で旧プレイヤーを破棄するため、切替中の旧ストリームも
     * 切断される。新側の準備失敗時はタイムアウトで回収する。
     */
    private deferPreviousMpegtsDestroy(): void {
        if (this.dp === null) return;

        const dp = this.dp as any;
        const originalInitMSE = typeof dp.initMSE === 'function' ? dp.initMSE.bind(dp) : null;
        if (originalInitMSE === null) return;

        dp.initMSE = (video: HTMLVideoElement, type: string): void => {
            // 3 回以上の連続切替では、現在の切替に不要になった旧側を先に回収する。
            // 旧保持を積み上げると streamProcessNum (既定4) を消費するため、保持は1本に制限する。
            this.cleanupDeferredMpegts();
            const previousMpegts = dp.plugins?.mpegts;
            const previousCaption = dp.plugins?.aribb24Caption;
            const previousSuperimpose = dp.plugins?.aribb24Superimpose;
            if (
                dp.options.live !== true ||
                type !== 'mpegts' ||
                previousMpegts === null ||
                typeof previousMpegts === 'undefined'
            ) {
                originalInitMSE(video, type);
                return;
            }

            // DPlayer の旧破棄処理を通さず、新プレイヤーを作らせる。
            dp.plugins.mpegts = undefined;
            dp.plugins.aribb24Caption = undefined;
            dp.plugins.aribb24Superimpose = undefined;
            try {
                originalInitMSE(video, type);
            } catch (err) {
                dp.plugins.mpegts = previousMpegts;
                // 新側の renderer 生成前に失敗した場合は旧側をそのまま復元する。
                // 成功時だけ上記で dispose 済みなので、失敗経路では破棄しない。
                dp.plugins.aribb24Caption = previousCaption;
                dp.plugins.aribb24Superimpose = previousSuperimpose;
                throw err;
            }

            // aribb24 renderer は旧 video の canvas と結び付いている。mpegts.js だけを
            // canplay まで保持し、renderer は新側の生成直後に破棄することで、旧 canvas が
            // 幅/高さ0の状態で字幕を描画する競合を避ける。
            try { previousCaption?.dispose?.(); } catch (err) { console.error(err); }
            try { previousSuperimpose?.dispose?.(); } catch (err) { console.error(err); }

            let finished = false;
            let timerId: number | undefined;
            const cleanup = (): void => {
                if (finished === true) return;
                finished = true;
                if (typeof timerId !== 'undefined') window.clearTimeout(timerId);
                this.deferredMpegtsCleanups.delete(cleanup);
                try { previousMpegts.unload?.(); } catch (err) { console.error(err); }
                try { previousMpegts.detachMediaElement?.(); } catch (err) { console.error(err); }
                try { previousMpegts.destroy?.(); } catch (err) { console.error(err); }
            };
            this.deferredMpegtsCleanups.add(cleanup);
            timerId = window.setTimeout(cleanup, LiveMpegTsVideo.MPEGTS_HANDOFF_TIMEOUT_MS);
        };
    }

    /** 保持中の旧 mpegts.js をまとめて停止する。 */
    private cleanupDeferredMpegts(): void {
        for (const cleanup of [...this.deferredMpegtsCleanups]) {
            try {
                cleanup();
            } catch (err) {
                console.error(err);
            }
        }
        // cleanup 内でも delete するが、例外や将来の変更があっても保持集合を残さない。
        this.deferredMpegtsCleanups.clear();
    }

    /**
     * DPlayer の設定 > 音声パネルへ主音声・副音声の切替を組み込む
     *
     * 再生中の画質 (m2tsll プロファイル) が embeddedAudioSwitch.m2tsll === true を返す場合、
     * サーバーは主音声・副音声の両方の ES を同一ストリームに含めて配信している (audioTrack=all)。
     * この場合は再接続せず mpegts.js の switchPrimaryAudio()/switchSecondaryAudio() を直接呼ぶ。
     * それ以外 (embeddedAudioSwitch が false / 不明) は従来どおり
     * 「audioTrack を変えた url へ差し替えて読み直す」方式にフォールバックする。
     * 番組情報が取れない放送局のために、一覧が空なら主音声・副音声の 2 択へ落とす
     */
    private setupLiveAudioTrackSwitch(): void {
        this.setupAudioTrackSwitch({
            tracks: this.audioTracksKnown ? this.audioTracks : LiveMpegTsVideo.FALLBACK_AUDIO_TRACKS,
            current: this.currentAudioTrack,
            onSelect: async track => {
                const dp = this.dp as any;
                if (dp === null) {
                    return;
                }

                if (this.isEmbeddedAudioSwitchMode(this.currentMode) === true) {
                    const mpegts = dp.plugins?.mpegts;
                    if (
                        typeof mpegts?.switchPrimaryAudio === 'function' &&
                        typeof mpegts?.switchSecondaryAudio === 'function'
                    ) {
                        if (LiveMpegTsVideo.isSecondaryAudioTrack(track) === true) {
                            mpegts.switchSecondaryAudio();
                        } else {
                            mpegts.switchPrimaryAudio();
                        }
                        this.currentAudioTrack = track;

                        return;
                    }
                    // mpegts プラグインが見つからない場合は下の再接続方式へフォールバックする
                }

                this.currentAudioTrack = track;
                // 画質切替と同じ経路で読み直す (音量・字幕表示などの復元も共通処理に任せる)
                dp.switchQuality(this.currentMode);
            },
        });
    }

    /**
     * 画質切替後、選択中の音声トラックを mpegts.js の新しいインスタンスへ再適用する
     * (embeddedAudioSwitch が有効なモードで、副音声を選んでいる場合のみ何かする)
     * @param mode: number 切替後の視聴設定
     */
    private reapplyEmbeddedAudioTrack(mode: number): void {
        if (this.isEmbeddedAudioSwitchMode(mode) === false) {
            return;
        }
        if (LiveMpegTsVideo.isSecondaryAudioTrack(this.currentAudioTrack) === false) {
            // 主音声は mpegts.js の新インスタンスの既定値なので何もしなくてよい
            return;
        }

        const dp = this.dp as any;
        const mpegts = dp?.plugins?.mpegts;
        if (typeof mpegts?.switchSecondaryAudio === 'function') {
            mpegts.switchSecondaryAudio();
        }
    }

    /**
     * 指定した mode (m2tsll の再生プロファイル) が主音声・副音声を再接続無しで
     * 切り替えられるか (embeddedAudioSwitch.m2tsll === true か) を返す
     * @param mode: number
     * @return boolean
     */
    private isEmbeddedAudioSwitchMode(mode: number): boolean {
        const profile = this.playbackProfiles.find(item => item.modes?.m2tsll === mode);

        return profile?.embeddedAudioSwitch?.m2tsll === true;
    }

    /**
     * 配信 url を組み立てる
     * embeddedAudioSwitch が有効なモードでは、主音声・副音声の両方を含めるため
     * audioTrack を 'all' に固定する (実際の選択は mpegts.js 側の切替で行う)。
     *
     * **主音声のときは embeddedAudioSwitch が分からなくても 'all' で開く**。playbackProfiles は
     * プレイヤー生成後に非同期で届くため、最初の url を組む時点ではまだ空のことが多い
     * (そのまま 'main' で開くと、tsreadex 経由でも副音声を含まない配信になり再接続無しで切り替えられない)。
     * サーバーは tsreadex を通さない cmd では 'all' を 'main' として扱うので、どちらの構成でも安全
     * @param mode: number 視聴設定
     * @param audioTrack: apid.AudioTrackSpecifier 音声トラック
     * @return string
     */
    private createStreamUrl(mode: number, audioTrack: apid.AudioTrackSpecifier): string {
        const track =
            this.isEmbeddedAudioSwitchMode(mode) === true || LiveMpegTsVideo.isSecondaryAudioTrack(audioTrack) === false
                ? 'all'
                : audioTrack;

        return `${window.location.origin}${Util.getSubDirectory()}/api/streams/live/${this.channelId}/m2tsll?mode=${mode}&audioTrack=${encodeURIComponent(track)}`;
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
    export const MPEGTS_HANDOFF_TIMEOUT_MS = 10_000;

    /**
     * 音声トラック指定子が副音声 (mpegts.js の switchSecondaryAudio() 相当) を指すか判定する
     * 'sub' / 音声 ES インデックス '1' を副音声とみなす ('main' / インデックス '0' / それ以外は主音声)
     * @param track: apid.AudioTrackSpecifier
     * @return boolean
     */
    export const isSecondaryAudioTrack = (track: apid.AudioTrackSpecifier): boolean => {
        if (track === 'sub') {
            return true;
        }
        if (track === 'main') {
            return false;
        }

        return Number.parseInt(track, 10) === 1;
    };

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
