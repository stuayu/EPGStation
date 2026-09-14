<template>
    <WatchLayout v-bind:panelTitle="displayInfo === null ? '' : displayInfo.channelName">
        <template v-slot:topBar>
            <WatchTopBar
                v-bind:logoSrc="logoSrc"
                v-bind:channelName="displayInfo === null ? '' : displayInfo.channelName"
                v-bind:programName="displayInfo === null ? '' : displayInfo.name"
                v-bind:timeText="displayInfo === null ? '' : displayInfo.shortTime"
            ></WatchTopBar>
        </template>
        <VideoContainer
            v-if="videoParam !== null"
            v-bind:key="videoKey"
            ref="videoContainer"
            v-bind:videoParam="videoParam"
            v-bind:dataBroadcastingAvailable="isFeatureEnabledDataBroadcasting"
            v-bind:dataBroadcastingEnabled="isEnabledDataBroadcasting"
            v-on:canplay="onVideoCanplay"
            v-on:dataBroadcastingToggle="onDataBroadcastingToggle"
            v-on:dataBroadcastingSeek="onDataBroadcastingSeek"
            v-on:jikkyoComment="onJikkyoComment"
            v-on:screenshotRequest="onScreenshotRequest"
            v-on:playbackContainerSwitch="onPlaybackContainerSwitch"
        ></VideoContainer>
        <v-alert v-if="streamingErrorMessage !== null" class="streaming-error" type="error" variant="tonal" role="alert">
            {{ streamingErrorMessage }}
        </v-alert>
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
                <template v-slot:sns>
                    <SnsPostPanel ref="snsPostPanel" v-bind:programInfo="displayInfo" v-bind:isLive="false"></SnsPostPanel>
                </template>
            </WatchSidePanel>
        </template>
    </WatchLayout>
</template>

<script lang="ts">
import DataBroadcastingRemote from '@/components/dataBroadcasting/DataBroadcastingRemote.vue';
import NextUpPanel from '@/components/recorded/watch/NextUpPanel.vue';
import WatchLayout from '@/components/watch/WatchLayout.vue';
import WatchPanelComments from '@/components/watch/WatchPanelComments.vue';
import WatchPanelProgram from '@/components/watch/WatchPanelProgram.vue';
import WatchSidePanel from '@/components/watch/WatchSidePanel.vue';
import WatchTopBar from '@/components/watch/WatchTopBar.vue';
import SnsPostPanel from '@/components/watch/sns/SnsPostPanel.vue';
import VideoContainer from '@/components/video/VideoContainer.vue';
import type { PlaybackContainerSwitchRequest, ScreenshotRequest } from '@/components/video/BaseVideo';
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
import { parseRecordedStreamingType } from '@/util/StreamingTypeUtil';
import StreamQualityUtil from '@/util/StreamQualityUtil';
import { isRecordedWatchModeValid, parseWatchRouteInteger } from '@/util/WatchRouteParamUtil';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';
import { markRaw } from 'vue';
import type { RouteLocationNormalized as Route, NavigationGuardNext } from 'vue-router';
import * as apid from '../../../api';

type RecordedTargetValidation =
    | { valid: true; videoFileType: apid.VideoFileType | null }
    | { valid: false; kind: 'recorded' | 'videoFile' };

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
        SnsPostPanel,
    },
})
class WatchRecordedStreaming extends Vue {
    public videoParam: VideoParam.RecordedStreamingParam | VideoParam.RecordedHLSParam | null = null;
    public streamingErrorMessage: string | null = null;

    /**
     * 上部バー・右パネルに出す録画番組の情報
     */
    public displayInfo: DsiplayWatchInfo | null = null;

    /**
     * 録画した放送局のロゴ URL
     * ロゴを持たない放送局では img の読み込みに失敗するため、表示側 (WatchTopBar) で握りつぶす
     */
    get logoSrc(): string | null {
        const channelId = this.displayInfo?.channelId ?? null;

        return channelId === null ? null : `./api/channels/${channelId.toString(10)}/logo`;
    }

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
        const tabs: WatchSidePanelTab[] = this.isEnabledNextUpPanel === true ? ['program', 'nextup', 'comment'] : ['program', 'comment'];
        if (this.settingStorageModel.tmp.isEnableSnsPanel === true) {
            tabs.push('sns');
        }

        return tabs;
    }

    /**
     * SNS 投稿パネルのキャプチャ添付用に、再生中の video 要素を返す
     * @return HTMLVideoElement | null
     */
    public onScreenshotRequest(request: ScreenshotRequest): void {
        (this.$refs.snsPostPanel as InstanceType<typeof SnsPostPanel> | undefined)?.onScreenshotRequest(request);
    }

    /** DPlayer の設定メニューから録画配信方式を切り替える。 */
    public onPlaybackContainerSwitch(request: PlaybackContainerSwitchRequest): void {
        if (this.videoParam === null || !('recordedId' in this.videoParam)) return;

        const common = {
            recordedId: this.videoParam.recordedId,
            videoFileId: this.videoParam.videoFileId,
            jikkyoChannelId: this.videoParam.jikkyoChannelId,
            jikkyoStartAt: this.videoParam.jikkyoStartAt,
            jikkyoEndAt: this.videoParam.jikkyoEndAt,
            playPosition: request.playPosition,
            mode: request.mode,
            profile: request.profileId,
        };
        if (request.container === 'hls') {
            this.videoParam = { type: 'RecordedHLS', ...common };
        } else {
            const streamingType = parseRecordedStreamingType(request.container);
            if (streamingType === null) return;
            this.videoParam = { type: 'RecordedStreaming', streamingType, ...common };
        }
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

    /** featureFlags.dataBroadcasting が有効か (DPlayer 操作ボタンの表示可否)。 */
    get isFeatureEnabledDataBroadcasting(): boolean {
        return isFeatureEnabled(this.serverConfigModel.getConfig(), 'dataBroadcasting');
    }

    /**
     * データ放送機能を実際に使うか (機能フラグが有効 かつ DPlayer 操作ボタンで ON にしている)
     */
    get isEnabledDataBroadcasting(): boolean {
        return this.isFeatureEnabledDataBroadcasting === true && this.settingStorageModel.tmp.isEnableDataBroadcasting === true;
    }

    public onDataBroadcastingToggle(): void {
        this.settingStorageModel.tmp.isEnableDataBroadcasting = !this.settingStorageModel.tmp.isEnableDataBroadcasting;
        this.settingStorageModel.save();
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
                getBroadcastTime: context.getBroadcastTime,
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
        this.streamingErrorMessage = null;

        // 視聴パラメータセット
        const videoFileId = parseWatchRouteInteger(Util.getRouteString(this.$route.params.id), 1);
        const recordedId = parseWatchRouteInteger(this.$route.query.recordedId, 1);
        const streamingTypeQuery = typeof this.$route.query.streamingType !== 'string' ? null : this.$route.query.streamingType;
        const streamingType = parseRecordedStreamingType(streamingTypeQuery);
        const mode = parseWatchRouteInteger(this.$route.query.mode, 0);
        const profile = typeof this.$route.query.profile === 'string' ? this.$route.query.profile : undefined;

        this.$nextTick(async () => {
            if (streamingTypeQuery !== null && streamingType === null) {
                this.showStreamingError(`この配信方式には対応していません。ページを再読み込みして、対応する配信方式を選び直してください。(指定: ${streamingTypeQuery})`);
            } else if (videoFileId === null || recordedId === null || mode === null || streamingType === null) {
                this.showStreamingError('録画視聴パラメータが不正です。ページを再読み込みして、録画一覧から選び直してください。');
            } else {
                const target = await this.validateRecordedTarget(recordedId, videoFileId);
                if (target.valid === false) {
                    this.showStreamingError(
                        target.kind === 'recorded'
                            ? '指定した録画番組が見つかりません。ページを再読み込みして、録画一覧から選び直してください。'
                            : '指定した録画ファイルが見つかりません。ページを再読み込みして、録画一覧から選び直してください。',
                    );
                } else if (
                    !isRecordedWatchModeValid(
                        mode,
                        target.videoFileType === null ? [] : StreamQualityUtil.getRecordedModeNames(target.videoFileType, streamingType),
                        profile,
                    )
                ) {
                    this.showStreamingError(`選択した画質設定 (mode=${mode}) は利用できません。ページを再読み込みして、画質を選び直してください。`);
                } else {
                    // ニコニコ実況 過去ログ再生用パラメータ取得
                    const jikkyoKakologParam = await this.getJikkyoKakologParam(recordedId, videoFileId);

                    if (streamingType === 'hls') {
                        this.videoParam = {
                            type: 'RecordedHLS',
                            recordedId: recordedId,
                            videoFileId: videoFileId,
                            mode: mode,
                            profile,
                            ...(jikkyoKakologParam ?? {}),
                        };
                    } else {
                        this.videoParam = {
                            type: 'RecordedStreaming',
                            recordedId: recordedId,
                            videoFileId: videoFileId,
                            streamingType: streamingType,
                            mode: mode,
                            profile,
                            ...(jikkyoKakologParam ?? {}),
                        };
                    }
                }

                // 上部バー・右パネル用の番組情報を取得する
                await this.updateProgramInfo();
            }

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }

    /**
     * 録画番組と録画ファイルの存在を確認する。
     * @param recordedId: apid.RecordedId
     * @param videoFileId: apid.VideoFileId
     * @return Promise<RecordedTargetValidation>
     */
    private async validateRecordedTarget(recordedId: apid.RecordedId, videoFileId: apid.VideoFileId): Promise<RecordedTargetValidation> {
        let recorded: apid.RecordedItem;
        try {
            recorded = await this.recordedApiModel.get(recordedId, true);
        } catch (err) {
            console.error(err);

            return { valid: false, kind: 'recorded' };
        }

        const videoFile = recorded.videoFiles?.find(item => item.id === videoFileId);
        if (typeof videoFile !== 'undefined') {
            return { valid: true, videoFileType: videoFile.type };
        }

        // videoFiles を返さない旧 API でも、メタデータ API で実在確認する。
        try {
            await this.videoApiModel.getMetadata(videoFileId);

            return { valid: true, videoFileType: null };
        } catch (err) {
            console.error(err);

            return { valid: false, kind: 'videoFile' };
        }
    }

    /**
     * URL の配信パラメータ異常を画面と Snackbar へ表示する。
     * ルート変更時に AppContent が Snackbar を閉じるため、通知はルート監視完了後に表示する。
     * @param message: string
     */
    private showStreamingError(message: string): void {
        this.streamingErrorMessage = message;
        window.setTimeout(() => {
            this.snackbarState.open({ color: 'error', text: message, timeout: 10000 });
        }, 0);
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

    /**
     * ページ離脱時に呼ばれる。ダウンロードも投稿もしていない SNS キャプチャが残っている場合は確認する
     */
    public handleBeforeRouteLeave(to: Route, from: Route, next: NavigationGuardNext): void {
        const hasUnsavedCaptures = (this.$refs.snsPostPanel as InstanceType<typeof SnsPostPanel> | undefined)?.hasUnsavedCaptures() ?? false;
        if (hasUnsavedCaptures === true && window.confirm('ダウンロードも投稿もしていない SNS キャプチャがあります。画面を離れると失われますがよろしいですか？') === false) {
            next(false);

            return;
        }
        next();
    }
}

export default Object.assign(toNative(WatchRecordedStreaming), {
    beforeRouteLeave(this: WatchRecordedStreaming, to: Route, from: Route, next: NavigationGuardNext): void {
        this.handleBeforeRouteLeave(to, from, next);
    },
});
</script>

<style lang="sass" scoped>
.streaming-error
    width: 100%
    min-height: 180px
    margin: 0
    display: flex
    align-items: center
    justify-content: center
    text-align: left
</style>
