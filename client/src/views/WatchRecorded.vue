<template>
    <v-main>
        <TitleBar title="視聴">
            <template v-slot:menu>
                <DataBroadcastingMenu v-if="isFeatureEnabledDataBroadcasting === true" v-on:changed="onDataBroadcastingEnabledChanged"></DataBroadcastingMenu>
            </template>
        </TitleBar>
        <transition name="page">
            <div class="watch-layout mx-auto">
                <div class="watch-main">
                    <VideoContainer
                        v-if="videoParam !== null"
                        ref="videoContainer"
                        v-bind:videoParam="videoParam"
                        v-on:ended="onVideoEnded"
                        v-on:remainingTime="onVideoRemainingTime"
                        v-on:canplay="onVideoCanplay"
                        v-on:dataBroadcastingSeek="onDataBroadcastingSeek"
                    ></VideoContainer>
                    <DataBroadcastingRemote
                        v-if="isEnabledDataBroadcasting === true"
                        v-bind:isUsingNumericKey="isDataBroadcastingUsingNumericKey"
                        v-bind:isLoading="isDataBroadcastingLoading"
                        v-on:key="onDataBroadcastingKey"
                    ></DataBroadcastingRemote>
                    <WatchOnRecordedInfoCard
                        v-if="recordedId !== null"
                        v-bind:recordedId="recordedId"
                        v-bind:videoFileId="videoParam !== null && 'videoFileId' in videoParam ? (videoParam.videoFileId ?? null) : null"
                    ></WatchOnRecordedInfoCard>
                </div>
                <NextUpPanel v-if="recordedId !== null && isEnabledNextUpPanel === true" ref="nextUpPanel" :recordedId="recordedId" :isHalfWidth="false"></NextUpPanel>
            </div>
        </transition>
    </v-main>
</template>

<script lang="ts">
import DataBroadcastingMenu from '@/components/dataBroadcasting/DataBroadcastingMenu.vue';
import DataBroadcastingRemote from '@/components/dataBroadcasting/DataBroadcastingRemote.vue';
import WatchOnRecordedInfoCard from '@/components/recorded/watch/WatchRecordedInfoCard.vue';
import NextUpPanel from '@/components/recorded/watch/NextUpPanel.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import VideoContainer from '@/components/video/VideoContainer.vue';
import { BaseVideoParam, NormalVideoParam } from '@/components/video/ViedoParam';
import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import IChannelModel from '@/model/channels/IChannelModel';
import container from '@/model/ModelContainer';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import DataBroadcastingManager from '@/util/DataBroadcastingManager';
import { isFeatureEnabled } from '@/util/FeatureFlags';
import { JikkyoKakologParam, resolveJikkyoKakologParam } from '@/util/JikkyoKakologParam';
import { AribKeyCode } from 'web-bml';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';
import { markRaw } from 'vue';
import * as apid from '../../../api';

@Component({
    components: {
        TitleBar,
        VideoContainer,
        WatchOnRecordedInfoCard,
        NextUpPanel,
        DataBroadcastingRemote,
        DataBroadcastingMenu,
    },
})
class WatchRecorded extends Vue {
    public videoParam: BaseVideoParam | null = null;
    public recordedId: apid.RecordedId | null = null;

    private recordedApiModel: IRecordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    private channelModel: IChannelModel = container.get<IChannelModel>('IChannelModel');
    private videoApiModel: IVideoApiModel = container.get<IVideoApiModel>('IVideoApiModel');
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private serverConfigModel: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');
    private settingStorageModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');

    // データ放送 (BML) 機能本体。Vue のリアクティブ監視に含めると内部の JS-Interpreter が壊れるため、
    // プレーンなフィールド (非 reactive) として保持する
    private dataBroadcastingManager: DataBroadcastingManager | null = null;
    public isDataBroadcastingUsingNumericKey: boolean = false;
    public isDataBroadcastingLoading: boolean = false;

    /**
     * featureFlags.nextUpPanel が有効か (無効時はパネル自体を表示しない)
     */
    get isEnabledNextUpPanel(): boolean {
        return isFeatureEnabled(this.serverConfigModel.getConfig(), 'nextUpPanel');
    }

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
     * VideoContainer からのシーク通知 (再生位置の飛び) を受けて、データ放送機能を作り直して張り直す。
     * 録画ファイル内のバイト位置 (BaseVideo.getDataBroadcastingParam の seek) が変わるため、
     * 差分更新ではなく Manager ごと作り直す
     */
    public onDataBroadcastingSeek(): void {
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

    /**
     * VideoContainer からの再生終了通知を Next Up パネルへ中継する
     */
    public onVideoEnded(): void {
        (this.$refs.nextUpPanel as InstanceType<typeof NextUpPanel> | undefined)?.onVideoEnded();
    }

    /**
     * VideoContainer からの残り再生時間通知を Next Up パネルへ中継する (連続再生カウントダウン用)
     */
    public onVideoRemainingTime(remainingSeconds: number): void {
        (this.$refs.nextUpPanel as InstanceType<typeof NextUpPanel> | undefined)?.onVideoRemainingTime(remainingSeconds);
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        // 動画が作り直されるため、先にデータ放送を破棄しておく (再セットアップは新しい video の canplay を待つ)
        void this.teardownDataBroadcasting();

        // 視聴パラメータセット
        const videoId = typeof this.$route.query.videoId !== 'string' ? null : parseInt(this.$route.query.videoId, 10);
        this.recordedId = typeof this.$route.query.recordedId !== 'string' ? null : parseInt(this.$route.query.recordedId, 10);

        this.$nextTick(async () => {
            const jikkyoKakologParam = this.recordedId === null ? null : await this.getJikkyoKakologParam(this.recordedId, videoId);
            if (videoId !== null) {
                (this.videoParam as NormalVideoParam) = {
                    type: 'Normal',
                    videoFileId: videoId,
                    src: `./api/videos/${videoId}`,
                    ...(jikkyoKakologParam ?? {}),
                };
            }

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }

    /**
     * 録画情報からニコニコ実況過去ログの取得パラメータを解決する
     * 基準時刻は録画ファイルの先頭に対応する実時刻 (`videoFile.startAt`) を使う
     * @param recordedId: apid.RecordedId
     * @param videoFileId: apid.VideoFileId | null
     * @return Promise<JikkyoKakologParam | null>
     */
    private async getJikkyoKakologParam(recordedId: apid.RecordedId, videoFileId: apid.VideoFileId | null): Promise<JikkyoKakologParam | null> {
        return resolveJikkyoKakologParam({
            recordedApiModel: this.recordedApiModel,
            channelModel: this.channelModel,
            videoApiModel: this.videoApiModel,
            recordedId: recordedId,
            videoFileId: videoFileId,
        });
    }
}

export default toNative(WatchRecorded);
</script>

<style lang="sass" scoped>
.watch-layout
    display: flex
    gap: 16px
    align-items: flex-start
    max-width: 1600px

.watch-main
    flex: 1
    min-width: 0

@media (max-width: 1200px)
    .watch-layout
        flex-direction: column
</style>
