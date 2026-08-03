<template>
    <WatchLayout v-bind:panelTitle="displayInfo === null ? '' : displayInfo.channelName">
        <template v-slot:topBar>
            <WatchTopBar
                v-bind:channelName="displayInfo === null ? '' : displayInfo.channelName"
                v-bind:programName="displayInfo === null ? '' : displayInfo.name"
                v-bind:timeText="displayInfo === null ? '' : displayInfo.shortTime"
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
            v-on:dataBroadcastingSeek="onDataBroadcastingSeek"
            v-on:jikkyoComment="onJikkyoComment"
        ></VideoContainer>
        <DataBroadcastingRemote
            v-if="isEnabledDataBroadcasting === true"
            v-bind:isUsingNumericKey="isDataBroadcastingUsingNumericKey"
            v-bind:isLoading="isDataBroadcastingLoading"
            v-on:key="onDataBroadcastingKey"
        ></DataBroadcastingRemote>
        <template v-slot:panel>
            <WatchSidePanel v-bind:tabs="panelTabs">
                <template v-slot:program>
                    <WatchPanelProgram v-bind:info="displayInfo"></WatchPanelProgram>
                </template>
                <template v-slot:nextup>
                    <NextUpPanel
                        v-if="videoParam !== null"
                        :recordedId="videoParam.recordedId"
                        :isHalfWidth="false"
                        :streamingType="videoParam.type === 'RecordedStreaming' ? videoParam.streamingType : 'hls'"
                        :mode="videoParam.mode"
                    ></NextUpPanel>
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
import NextUpPanel from '@/components/recorded/watch/NextUpPanel.vue';
import WatchLayout from '@/components/watch/WatchLayout.vue';
import WatchPanelComments from '@/components/watch/WatchPanelComments.vue';
import WatchPanelProgram from '@/components/watch/WatchPanelProgram.vue';
import WatchSidePanel from '@/components/watch/WatchSidePanel.vue';
import WatchTopBar from '@/components/watch/WatchTopBar.vue';
import VideoContainer from '@/components/video/VideoContainer.vue';
import * as VideoParam from '@/components/video/ViedoParam';
import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import IChannelModel from '@/model/channels/IChannelModel';
import container from '@/model/ModelContainer';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import { ISettingStorageModel, WatchSidePanelTab } from '@/model/storage/setting/ISettingStorageModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IWatchRecordedInfoState, { DsiplayWatchInfo } from '@/model/state/recorded/watch/IWatchRecordedInfoState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import DataBroadcastingManager from '@/util/DataBroadcastingManager';
import { isFeatureEnabled } from '@/util/FeatureFlags';
import { JikkyoComment } from '@/util/JikkyoCommentClient';
import { JikkyoKakologParam, resolveJikkyoKakologParam } from '@/util/JikkyoKakologParam';
import Util from '@/util/Util';
import { AribKeyCode } from 'web-bml';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';
import { markRaw } from 'vue';
import * as apid from '../../../api';

@Component({
    components: {
        WatchLayout,
        WatchTopBar,
        WatchSidePanel,
        WatchPanelProgram,
        WatchPanelComments,
        VideoContainer,
        NextUpPanel,
        DataBroadcastingRemote,
        DataBroadcastingMenu,
    },
})
class WatchRecordedStreaming extends Vue {
    public videoParam: VideoParam.RecordedStreamingParam | VideoParam.RecordedHLSParam | null = null;

    /**
     * 上部バー・右パネルに出す録画番組の情報
     */
    public displayInfo: DsiplayWatchInfo | null = null;

    /**
     * 右パネルに並べる実況コメント (古いものから順に保持する)
     */
    public jikkyoComments: JikkyoComment[] = [];

    // 保持するコメントの上限 (超えた分は古いものから捨てる)
    private static readonly JIKKYO_COMMENT_LIMIT = 500;

    private infoState: IWatchRecordedInfoState = container.get<IWatchRecordedInfoState>('IWatchRecordedInfoState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    /**
     * VideoContainer の再生成キー
     * 各 video コンポーネントは mounted 時にしか DPlayer を作らないため、
     * 再生対象が変わったら VideoContainer ごと作り直さないと動画が切り替わらない
     */
    get videoKey(): string {
        if (this.videoParam === null) {
            return 'none';
        }

        const streamingType = this.videoParam.type === 'RecordedStreaming' ? this.videoParam.streamingType : 'hls';

        return `${streamingType}-${this.videoParam.videoFileId}-${this.videoParam.mode}`;
    }

    /**
     * 右パネルのタブ構成 (Next Up パネルは機能フラグで出し分ける)
     */
    get panelTabs(): WatchSidePanelTab[] {
        return this.isEnabledNextUpPanel === true ? ['program', 'nextup', 'comment'] : ['program', 'comment'];
    }

    /**
     * 録画番組の情報を取得し直す
     */
    private async updateProgramInfo(): Promise<void> {
        if (this.videoParam === null) {
            return;
        }

        await this.infoState.update(this.videoParam.recordedId).catch(err => {
            this.snackbarState.open({
                color: 'error',
                text: '番組情報取得に失敗',
            });
            console.error(err);
        });

        this.displayInfo = this.infoState.getInfo();
    }

    /**
     * 映像に流れた実況コメントを右パネル用に貯める
     * @param comment: JikkyoComment
     */
    public onJikkyoComment(comment: JikkyoComment): void {
        this.jikkyoComments.push(comment);

        if (this.jikkyoComments.length > WatchRecordedStreaming.JIKKYO_COMMENT_LIMIT) {
            this.jikkyoComments.splice(0, this.jikkyoComments.length - WatchRecordedStreaming.JIKKYO_COMMENT_LIMIT);
        }
    }

    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private recordedApiModel: IRecordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    private channelModel: IChannelModel = container.get<IChannelModel>('IChannelModel');
    private videoApiModel: IVideoApiModel = container.get<IVideoApiModel>('IVideoApiModel');
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

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        // 動画が作り直されるため、先にデータ放送を破棄しておく (再セットアップは新しい video の canplay を待つ)
        void this.teardownDataBroadcasting();

        // 番組情報とコメントは動画の切り替えのたびに取り直す
        this.infoState.clear();
        this.displayInfo = null;
        this.jikkyoComments = [];
        // 古い動画を残さない (パラメータ不足の URL へ遷移した場合にそのまま再生され続けるのを防ぐ)
        this.videoParam = null;

        // 視聴パラメータセット
        const videoFileId = parseInt(Util.getRouteString(this.$route.params.id) ?? '', 10);
        const recordedId = typeof this.$route.query.recordedId !== 'string' ? null : parseInt(this.$route.query.recordedId, 10);
        const streamingType = typeof this.$route.query.streamingType !== 'string' ? null : this.$route.query.streamingType;
        const mode = typeof this.$route.query.mode !== 'string' ? null : parseInt(this.$route.query.mode, 10);

        this.$nextTick(async () => {
            if (videoFileId !== null && recordedId !== null && streamingType !== null && mode !== null) {
                // ニコニコ実況 過去ログ再生用パラメータ取得
                const jikkyoKakologParam = await this.getJikkyoKakologParam(recordedId, videoFileId);

                if (streamingType === 'hls') {
                    this.videoParam = {
                        type: 'RecordedHLS',
                        recordedId: recordedId,
                        videoFileId: videoFileId,
                        mode: mode,
                        ...(jikkyoKakologParam ?? {}),
                    };
                } else {
                    this.videoParam = {
                        type: 'RecordedStreaming',
                        recordedId: recordedId,
                        videoFileId: videoFileId,
                        streamingType: streamingType,
                        mode: mode,
                        ...(jikkyoKakologParam ?? {}),
                    };
                }
            }

            // 上部バー・右パネル用の番組情報を取得する
            await this.updateProgramInfo();

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }

    /**
     * ニコニコ実況 過去ログ取得に必要なパラメータを生成する
     * 基準時刻は録画ファイルの先頭に対応する実時刻 (`videoFile.startAt`) を使う
     * @param recordedId: apid.RecordedId
     * @param videoFileId: apid.VideoFileId
     * @return Promise<JikkyoKakologParam | null>
     */
    private async getJikkyoKakologParam(recordedId: apid.RecordedId, videoFileId: apid.VideoFileId): Promise<JikkyoKakologParam | null> {
        return resolveJikkyoKakologParam({
            recordedApiModel: this.recordedApiModel,
            channelModel: this.channelModel,
            videoApiModel: this.videoApiModel,
            recordedId: recordedId,
            videoFileId: videoFileId,
        });
    }
}

export default toNative(WatchRecordedStreaming);
</script>
