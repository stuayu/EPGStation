<template>
    <WatchLayout v-bind:panelTitle="channelName">
        <template v-slot:topBar>
            <WatchTopBar
                v-bind:logoSrc="logoSrc"
                v-bind:channelName="channelName"
                v-bind:programName="displayInfo === null ? '' : displayInfo.name"
                v-bind:timeText="displayInfo === null ? '' : displayInfo.shortTime"
                v-bind:showClock="true"
            >
                <template v-slot:menu>
                    <DataBroadcastingMenu v-if="isFeatureEnabledDataBroadcasting === true" v-on:changed="onDataBroadcastingEnabledChanged"></DataBroadcastingMenu>
                </template>
            </WatchTopBar>
        </template>
        <VideoContainer
            v-if="videoParam !== null"
            v-bind:key="videoKey"
            ref="videoContainer"
            v-bind:videoParam="videoParam"
            v-on:canplay="onVideoCanplay"
            v-on:jikkyoComment="onJikkyoComment"
        ></VideoContainer>
        <DataBroadcastingRemote
            v-if="isEnabledDataBroadcasting === true"
            v-bind:isUsingNumericKey="isDataBroadcastingUsingNumericKey"
            v-bind:isLoading="isDataBroadcastingLoading"
            v-on:key="onDataBroadcastingKey"
        ></DataBroadcastingRemote>
        <div class="channel-switch">
            <v-btn icon variant="text" title="前のチャンネル" v-on:click="switchChannel(-1)">
                <v-icon>mdi-chevron-up</v-icon>
            </v-btn>
            <v-btn icon variant="text" title="次のチャンネル" v-on:click="switchChannel(1)">
                <v-icon>mdi-chevron-down</v-icon>
            </v-btn>
        </div>
        <template v-slot:panel>
            <WatchSidePanel v-bind:tabs="panelTabs">
                <template v-slot:program>
                    <WatchPanelProgram v-bind:info="displayInfo"></WatchPanelProgram>
                </template>
                <template v-slot:channel>
                    <WatchPanelChannels v-bind:currentChannelId="watchParam === null ? null : watchParam.channel" v-on:select="moveChannel"></WatchPanelChannels>
                </template>
                <template v-slot:comment>
                    <WatchPanelComments v-bind:comments="jikkyoComments"></WatchPanelComments>
                </template>
            </WatchSidePanel>
        </template>
    </WatchLayout>
</template>

<script lang="ts">
import DataBroadcastingMenu from '@/components/dataBroadcasting/DataBroadcastingMenu.vue';
import DataBroadcastingRemote from '@/components/dataBroadcasting/DataBroadcastingRemote.vue';
import WatchLayout from '@/components/watch/WatchLayout.vue';
import WatchPanelChannels from '@/components/watch/WatchPanelChannels.vue';
import WatchPanelComments from '@/components/watch/WatchPanelComments.vue';
import WatchPanelProgram from '@/components/watch/WatchPanelProgram.vue';
import WatchSidePanel from '@/components/watch/WatchSidePanel.vue';
import WatchTopBar from '@/components/watch/WatchTopBar.vue';
import VideoContainer from '@/components/video/VideoContainer.vue';
import { BaseVideoParam, LiveHLSParam, LiveMpegTsVideoParam, NormalVideoParam } from '@/components/video/ViedoParam';
import container from '@/model/ModelContainer';
import IChannelModel from '@/model/channels/IChannelModel';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import { ISettingStorageModel, WatchSidePanelTab } from '@/model/storage/setting/ISettingStorageModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IOnAirState from '@/model/state/onair/IOnAirState';
import IWatchOnAirInfoState, { DsiplayWatchInfo } from '@/model/state/onair/watch/IWatchOnAirInfoState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import DataBroadcastingManager from '@/util/DataBroadcastingManager';
import { isFeatureEnabled } from '@/util/FeatureFlags';
import { JikkyoComment } from '@/util/JikkyoCommentClient';
import JikkyoUtil from '@/util/JikkyoUtil';
import Util from '@/util/Util';
import { AribKeyCode } from 'web-bml';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';
import { markRaw } from 'vue';
import * as apid from '../../../api';

interface WatchParam {
    type: string;
    channel: apid.ChannelId;
    mode: number;
}

@Component({
    components: {
        WatchLayout,
        WatchTopBar,
        WatchSidePanel,
        WatchPanelProgram,
        WatchPanelChannels,
        WatchPanelComments,
        VideoContainer,
        DataBroadcastingRemote,
        DataBroadcastingMenu,
    },
})
class WatchOnAir extends Vue {
    public videoParam: BaseVideoParam | null = null;

    private channelModel: IChannelModel = container.get<IChannelModel>('IChannelModel');
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private serverConfigModel: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');
    private settingStorageModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');

    public watchParam: WatchParam | null = null;

    /**
     * 上部バー・右パネルに出す視聴中番組の情報
     */
    public displayInfo: DsiplayWatchInfo | null = null;

    public panelTabs: WatchSidePanelTab[] = ['program', 'channel', 'comment'];

    /**
     * VideoContainer の再生成キー
     * 各 video コンポーネントは mounted 時にしか DPlayer を作らないため、
     * 視聴対象 (配信種別・放送局・エンコード設定) が変わったら VideoContainer ごと
     * 作り直さないと映像が切り替わらない
     */
    get videoKey(): string {
        return this.watchParam === null ? 'none' : `${this.watchParam.type}-${this.watchParam.channel}-${this.watchParam.mode}`;
    }

    /**
     * 右パネルに並べる実況コメント (古いものから順に保持する)
     */
    public jikkyoComments: JikkyoComment[] = [];

    // 保持するコメントの上限 (超えた分は古いものから捨てる)
    private static readonly JIKKYO_COMMENT_LIMIT = 500;

    private infoState: IWatchOnAirInfoState = container.get<IWatchOnAirInfoState>('IWatchOnAirInfoState');
    private onAirState: IOnAirState = container.get<IOnAirState>('IOnAirState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private infoUpdateTimer: ReturnType<typeof setTimeout> | null = null;
    private onUpdateStatusCallback = (async (): Promise<void> => {
        await this.updateProgramInfo();
    }).bind(this);
    // EIT[p/f] が流れてきたら、視聴中の放送局のときだけ番組情報を取り直す
    private onUpdateOnAirProgramCallback = ((payload: { channelIds: number[] }): void => {
        if (Array.isArray(payload?.channelIds) === false || this.watchParam === null) {
            return;
        }
        if (payload.channelIds.includes(this.watchParam.channel) === false) {
            return;
        }
        void this.updateProgramInfo();
    }).bind(this);

    /**
     * 視聴中の放送局名
     */
    get channelName(): string {
        if (this.displayInfo !== null) {
            return this.displayInfo.channelName;
        }

        if (this.watchParam === null) {
            return '';
        }

        return this.channelModel.findChannel(this.watchParam.channel, true)?.name ?? '';
    }

    /**
     * 視聴中の放送局のロゴ URL (ロゴを持たない放送局では img の読み込みに失敗するため、表示側で握りつぶす)
     */
    get logoSrc(): string | null {
        return this.watchParam === null ? null : `./api/channels/${this.watchParam.channel.toString(10)}/logo`;
    }

    // データ放送 (BML) 機能本体。Vue のリアクティブ監視に含めると内部の JS-Interpreter が壊れるため、
    // プレーンなフィールド (非 reactive) として保持する
    private dataBroadcastingManager: DataBroadcastingManager | null = null;
    public isDataBroadcastingUsingNumericKey: boolean = false;
    public isDataBroadcastingLoading: boolean = false;

    /**
     * featureFlags.dataBroadcasting が有効か (3 点リーダーのメニュー自体の表示可否)
     */
    get isFeatureEnabledDataBroadcasting(): boolean {
        return isFeatureEnabled(this.serverConfigModel.getConfig(), 'dataBroadcasting');
    }

    /**
     * データ放送機能を実際に使うか (機能フラグが有効 かつ 3 点リーダーのメニューで ON にしている)
     */
    get isEnabledDataBroadcasting(): boolean {
        return this.isFeatureEnabledDataBroadcasting === true && this.settingStorageModel.tmp.isEnableDataBroadcasting === true;
    }

    public onDataBroadcastingEnabledChanged(): void {
        void this.setupDataBroadcasting();
    }

    /**
     * VideoContainer から DPlayer が再生可能になったことを通知されたら、データ放送機能を (再) セットアップする
     */
    public onVideoCanplay(): void {
        void this.setupDataBroadcasting();
    }

    /**
     * データ放送機能を作り直す (一度破棄してから、必要であれば新しい DPlayer インスタンスで作り直す)
     */
    private async setupDataBroadcasting(): Promise<void> {
        await this.teardownDataBroadcasting();

        if (this.isEnabledDataBroadcasting === false) {
            return;
        }

        const videoContainer = this.$refs.videoContainer as InstanceType<typeof VideoContainer> | undefined;
        const context = videoContainer?.getDataBroadcastingContext();
        if (typeof context === 'undefined' || context === null) {
            return;
        }

        // markRaw() が必須: vue-facing-decorator のクラスプロパティは Vue のリアクティブ監視の対象になり、
        // 内部に BMLBrowser (JS-Interpreter を持つ) を保持するこのインスタンスがリアクティブ化されると壊れる
        this.dataBroadcastingManager = markRaw(
            new DataBroadcastingManager(context.dp, context.param, {
                onUsedKeyListChanged: isUsing => {
                    this.isDataBroadcastingUsingNumericKey = isUsing;
                },
                onLoadingChanged: loading => {
                    this.isDataBroadcastingLoading = loading;
                },
            }),
        );
        await this.dataBroadcastingManager.init();
    }

    private async teardownDataBroadcasting(): Promise<void> {
        this.isDataBroadcastingUsingNumericKey = false;
        this.isDataBroadcastingLoading = false;

        if (this.dataBroadcastingManager === null) {
            return;
        }
        const manager = this.dataBroadcastingManager;
        this.dataBroadcastingManager = null;
        await manager.destroy().catch(err => console.error(err));
    }

    public onDataBroadcastingKey(keyCode: AribKeyCode): void {
        this.dataBroadcastingManager?.sendKey(keyCode);
    }

    public created(): void {
        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
        this.socketIoModel.onUpdateOnAirProgram(this.onUpdateOnAirProgramCallback);
    }

    public beforeUnmount(): void {
        void this.teardownDataBroadcasting();

        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);
        this.socketIoModel.offUpdateOnAirProgram(this.onUpdateOnAirProgramCallback);

        if (this.infoUpdateTimer !== null) {
            clearTimeout(this.infoUpdateTimer);
            this.infoUpdateTimer = null;
        }
    }

    /**
     * 映像に流れた実況コメントを右パネル用に貯める
     * @param comment: JikkyoComment
     */
    public onJikkyoComment(comment: JikkyoComment): void {
        this.jikkyoComments.push(comment);

        if (this.jikkyoComments.length > WatchOnAir.JIKKYO_COMMENT_LIMIT) {
            this.jikkyoComments.splice(0, this.jikkyoComments.length - WatchOnAir.JIKKYO_COMMENT_LIMIT);
        }
    }

    /**
     * 視聴する放送局を切り替える (配信種別・エンコード設定は今の視聴と同じものを引き継ぐ)
     * @param channelId: apid.ChannelId
     */
    public async moveChannel(channelId: apid.ChannelId): Promise<void> {
        if (this.watchParam === null || this.watchParam.channel === channelId) {
            return;
        }

        await Util.move(this.$router, {
            path: '/onair/watch',
            query: {
                type: this.watchParam.type,
                channel: channelId.toString(10),
                mode: this.watchParam.mode.toString(10),
            },
        }).catch(err => {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: 'チャンネルの切り替えに失敗',
            });
        });
    }

    /**
     * 放送中の放送局一覧を基準に、前後のチャンネルへ移動する
     * @param direction: number -1: 前, 1: 次
     */
    public async switchChannel(direction: number): Promise<void> {
        if (this.watchParam === null) {
            return;
        }

        const schedules = this.onAirState.getSchedules();
        if (schedules.length === 0) {
            return;
        }

        const currentIndex = schedules.findIndex(s => {
            return s.display.channelId === this.watchParam?.channel;
        });

        // 一覧に無い放送局を視聴している場合は先頭から始める
        const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + schedules.length) % schedules.length;

        await this.moveChannel(schedules[nextIndex].display.channelId);
    }

    /**
     * 視聴中番組の情報を取得し直し、番組終了時刻に合わせて次の更新を予約する
     */
    private async updateProgramInfo(): Promise<void> {
        if (this.watchParam === null) {
            return;
        }

        await this.infoState.update(this.watchParam.channel, this.watchParam.mode).catch(err => {
            this.snackbarState.open({
                color: 'error',
                text: 'ストリーム情報取得に失敗',
            });
            console.error(err);
        });

        this.displayInfo = this.infoState.getInfo();

        if (this.infoUpdateTimer !== null) {
            clearTimeout(this.infoUpdateTimer);
        }
        this.infoUpdateTimer = setTimeout(() => {
            void this.updateProgramInfo();
        }, this.infoState.getUpdateTime());
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        // チャンネル切り替え等で video が作り直されるため、先にデータ放送を破棄しておく
        // (再セットアップは新しい video の canplay を待って onVideoCanplay で行う)
        void this.teardownDataBroadcasting();

        // 番組情報・コメントはチャンネル切り替えのたびに取り直す
        this.infoState.clear();
        this.displayInfo = null;
        this.jikkyoComments = [];
        // 古い映像を残さない (視聴対象が無い URL へ遷移した場合にそのまま再生され続けるのを防ぐ)
        this.videoParam = null;

        // 視聴パラメータセット
        this.watchParam =
            typeof this.$route.query.type !== 'string' || typeof this.$route.query.channel !== 'string' || typeof this.$route.query.mode !== 'string'
                ? null
                : {
                      type: this.$route.query.type,
                      channel: parseInt(this.$route.query.channel, 10),
                      mode: parseInt(this.$route.query.mode, 10),
                  };

        this.$nextTick(async () => {
            if (this.watchParam !== null) {
                // ニコニコ実況の実況チャンネル ID (jk1 など) を解決する
                const jikkyoChannelId = await this.findJikkyoChannelId(this.watchParam.channel);

                if (this.watchParam.type === 'hls') {
                    (this.videoParam as LiveHLSParam) = {
                        type: 'LiveHLS',
                        channelId: this.watchParam.channel,
                        mode: this.watchParam.mode,
                        jikkyoChannelId: jikkyoChannelId,
                    };
                } else if (this.watchParam.type === 'm2tsll') {
                    (this.videoParam as LiveMpegTsVideoParam) = {
                        type: 'LiveMpegTs',
                        src: `${window.location.origin}${Util.getSubDirectory()}/api/streams/live/${this.watchParam.channel}/m2tsll?mode=${this.watchParam.mode}`,
                        channelId: this.watchParam.channel,
                        mode: this.watchParam.mode,
                        jikkyoChannelId: jikkyoChannelId,
                    };
                } else {
                    (this.videoParam as NormalVideoParam) = {
                        type: 'Normal',
                        src: `./api/streams/live/${this.watchParam.channel}/${this.watchParam.type}?mode=${this.watchParam.mode}`,
                        jikkyoChannelId: jikkyoChannelId,
                    };
                }
                // 上部バー・右パネル用の番組情報を取得する
                await this.updateProgramInfo();
            }

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }

    /**
     * 視聴チャンネルからニコニコ実況の実況チャンネル ID を解決する
     * @param channelId: apid.ChannelId
     * @return Promise<string | undefined> 解決できなかった場合は undefined
     */
    private async findJikkyoChannelId(channelId: apid.ChannelId): Promise<string | undefined> {
        try {
            let channel = this.channelModel.findChannel(channelId, true);
            if (channel === null) {
                await this.channelModel.fetchChannels();
                channel = this.channelModel.findChannel(channelId, true);
            }

            if (channel === null) {
                return undefined;
            }

            const jikkyoChannelId = JikkyoUtil.findJikkyoChannelId(channel);

            return jikkyoChannelId === null ? undefined : jikkyoChannelId;
        } catch (err) {
            console.error(err);

            return undefined;
        }
    }
}

export default toNative(WatchOnAir);
</script>

<style lang="sass" scoped>
// 映像の右端に重ねるチャンネル切り替えボタン
.channel-switch
    position: absolute
    top: 50%
    right: 8px
    z-index: 2
    display: flex
    flex-direction: column
    gap: 8px
    transform: translateY(-50%)
    opacity: 0.6
    transition: opacity 0.2s

    &:hover
        opacity: 1

    .v-btn
        background: rgba(0, 0, 0, 0.5)
        color: #fff
</style>
