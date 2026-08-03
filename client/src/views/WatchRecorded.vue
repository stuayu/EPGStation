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
            v-on:ended="onVideoEnded"
            v-on:remainingTime="onVideoRemainingTime"
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
                    <WatchPanelProgram v-bind:info="displayInfo">
                        <template v-slot:actions>
                            <v-btn v-if="videoFileId !== null" size="small" variant="outlined" v-on:click="toggleWatched">
                                {{ watchHistory !== null && watchHistory.status === 'watched' ? '未視聴に戻す' : '視聴済みにする' }}
                            </v-btn>
                        </template>
                    </WatchPanelProgram>
                </template>
                <template v-slot:nextup>
                    <NextUpPanel v-if="recordedId !== null" ref="nextUpPanel" :recordedId="recordedId" :isHalfWidth="false"></NextUpPanel>
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
import { BaseVideoParam, NormalVideoParam } from '@/components/video/ViedoParam';
import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import IChannelModel from '@/model/channels/IChannelModel';
import container from '@/model/ModelContainer';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import { ISettingStorageModel, WatchSidePanelTab } from '@/model/storage/setting/ISettingStorageModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IWatchRecordedInfoState, { DsiplayWatchInfo } from '@/model/state/recorded/watch/IWatchRecordedInfoState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import DataBroadcastingManager from '@/util/DataBroadcastingManager';
import { isFeatureEnabled } from '@/util/FeatureFlags';
import { JikkyoComment } from '@/util/JikkyoCommentClient';
import { JikkyoKakologParam, resolveJikkyoKakologParam } from '@/util/JikkyoKakologParam';
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
class WatchRecorded extends Vue {
    public videoParam: BaseVideoParam | null = null;
    public recordedId: apid.RecordedId | null = null;

    /**
     * 上部バー・右パネルに出す録画番組の情報
     */
    public displayInfo: DsiplayWatchInfo | null = null;

    /**
     * 再生中のビデオファイルの視聴履歴 (視聴済みボタンの表示に使う)
     */
    public watchHistory: apid.WatchHistory | null = null;

    /**
     * 右パネルに並べる実況コメント (古いものから順に保持する)
     */
    public jikkyoComments: JikkyoComment[] = [];

    // 保持するコメントの上限 (超えた分は古いものから捨てる)
    private static readonly JIKKYO_COMMENT_LIMIT = 500;

    private infoState: IWatchRecordedInfoState = container.get<IWatchRecordedInfoState>('IWatchRecordedInfoState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async (): Promise<void> => {
        await this.updateProgramInfo();
    }).bind(this);

    /**
     * 右パネルのタブ構成 (Next Up パネルは機能フラグで出し分ける)
     */
    get panelTabs(): WatchSidePanelTab[] {
        return this.isEnabledNextUpPanel === true ? ['program', 'nextup', 'comment'] : ['program', 'comment'];
    }

    /**
     * VideoContainer の再生成キー
     * 各 video コンポーネントは mounted 時にしか DPlayer を作らないため、
     * 再生対象が変わったら VideoContainer ごと作り直さないと動画が切り替わらない
     */
    get videoKey(): string {
        return `normal-${this.videoFileId ?? 'none'}`;
    }

    /**
     * 再生中のビデオファイル ID
     */
    get videoFileId(): apid.VideoFileId | null {
        return this.videoParam !== null && 'videoFileId' in this.videoParam ? (this.videoParam.videoFileId ?? null) : null;
    }

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

    public created(): void {
        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    public beforeUnmount(): void {
        void this.teardownDataBroadcasting();

        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);
    }

    /**
     * 録画番組の情報と視聴履歴を取得し直す
     */
    private async updateProgramInfo(): Promise<void> {
        if (this.recordedId === null) {
            return;
        }

        await this.infoState.update(this.recordedId).catch(err => {
            this.snackbarState.open({
                color: 'error',
                text: '番組情報取得に失敗',
            });
            console.error(err);
        });

        this.displayInfo = this.infoState.getInfo();

        if (this.videoFileId !== null) {
            this.watchHistory = await this.videoApiModel.getPlaybackPosition(this.videoFileId);
        }
    }

    /**
     * 視聴済み / 未視聴を切り替える
     */
    public async toggleWatched(): Promise<void> {
        const videoFileId = this.videoFileId;
        if (videoFileId === null) {
            return;
        }

        try {
            const duration = this.watchHistory?.duration ?? (await this.videoApiModel.getDuration(videoFileId));
            if (duration <= 0) {
                this.snackbarState.open({
                    color: 'error',
                    text: '動画の長さを取得できないため視聴状態を変更できません',
                });

                return;
            }

            const position = this.watchHistory?.status === 'watched' ? 0 : duration;
            this.watchHistory = await this.videoApiModel.savePlaybackPosition(videoFileId, { position, duration });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: '視聴状態の更新に失敗',
            });
        }
    }

    /**
     * 映像に流れた実況コメントを右パネル用に貯める
     * @param comment: JikkyoComment
     */
    public onJikkyoComment(comment: JikkyoComment): void {
        this.jikkyoComments.push(comment);

        if (this.jikkyoComments.length > WatchRecorded.JIKKYO_COMMENT_LIMIT) {
            this.jikkyoComments.splice(0, this.jikkyoComments.length - WatchRecorded.JIKKYO_COMMENT_LIMIT);
        }
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

        // 番組情報とコメントは動画の切り替えのたびに取り直す
        this.infoState.clear();
        this.displayInfo = null;
        this.watchHistory = null;
        this.jikkyoComments = [];
        // 古い動画を残さない (再生対象が無い URL へ遷移した場合にそのまま再生され続けるのを防ぐ)
        this.videoParam = null;

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

            // 上部バー・右パネル用の番組情報を取得する
            await this.updateProgramInfo();

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
