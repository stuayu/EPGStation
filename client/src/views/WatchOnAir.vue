<template>
    <v-main>
        <TitleBar title="視聴">
            <template v-slot:menu>
                <DataBroadcastingMenu v-if="isFeatureEnabledDataBroadcasting === true" v-on:changed="onDataBroadcastingEnabledChanged"></DataBroadcastingMenu>
            </template>
        </TitleBar>
        <transition name="page">
            <div class="video-container-wrap mx-auto">
                <VideoContainer v-if="videoParam !== null" ref="videoContainer" v-bind:videoParam="videoParam" v-on:canplay="onVideoCanplay"></VideoContainer>
                <DataBroadcastingRemote
                    v-if="isEnabledDataBroadcasting === true"
                    v-bind:isUsingNumericKey="isDataBroadcastingUsingNumericKey"
                    v-bind:isLoading="isDataBroadcastingLoading"
                    v-on:key="onDataBroadcastingKey"
                ></DataBroadcastingRemote>
                <WatchOnAirInfoCard v-if="watchParam !== null" v-bind:channel="watchParam.channel" v-bind:mode="watchParam.mode"></WatchOnAirInfoCard>
                <div style="visibility: hidden">dummy</div>
            </div>
        </transition>
    </v-main>
</template>

<script lang="ts">
import DataBroadcastingMenu from '@/components/dataBroadcasting/DataBroadcastingMenu.vue';
import DataBroadcastingRemote from '@/components/dataBroadcasting/DataBroadcastingRemote.vue';
import WatchOnAirInfoCard from '@/components/onair/watch/WatchOnAirInfoCard.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import VideoContainer from '@/components/video/VideoContainer.vue';
import { BaseVideoParam, LiveHLSParam, LiveMpegTsVideoParam, NormalVideoParam } from '@/components/video/ViedoParam';
import container from '@/model/ModelContainer';
import IChannelModel from '@/model/channels/IChannelModel';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import DataBroadcastingManager from '@/util/DataBroadcastingManager';
import { isFeatureEnabled } from '@/util/FeatureFlags';
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
        TitleBar,
        VideoContainer,
        WatchOnAirInfoCard,
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

    public beforeUnmount(): void {
        void this.teardownDataBroadcasting();
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        // チャンネル切り替え等で video が作り直されるため、先にデータ放送を破棄しておく
        // (再セットアップは新しい video の canplay を待って onVideoCanplay で行う)
        void this.teardownDataBroadcasting();

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
.video-container-wrap
    max-width: 1200px
</style>
