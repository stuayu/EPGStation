<template>
    <WatchLayout :panelTitle="displayInfo.channelName ?? ''" :backPath="returnPath">
        <template #topBar>
            <WatchTopBar
                :logoSrc="video?.channelLogoURL ?? null"
                :channelName="displayInfo.channelName ?? null"
                :programName="displayInfo.name"
                :timeText="displayInfo.shortTime ?? ''"
            ></WatchTopBar>
        </template>
        <VideoContainer
            v-if="videoParam !== null"
            ref="videoContainer"
            :key="videoKey"
            :videoParam="videoParam"
            :dataBroadcastingAvailable="isDataBroadcastingAvailable"
            :dataBroadcastingEnabled="isEnabledDataBroadcasting"
            @canplay="onVideoCanplay"
            @dataBroadcastingToggle="onDataBroadcastingToggle"
            @dataBroadcastingSeek="onDataBroadcastingSeek"
            @playbackPosition="onPlaybackPosition"
            @jikkyoComment="onJikkyoComment"
            @jikkyoError="onJikkyoError"
            @screenshotRequest="onScreenshotRequest"
        ></VideoContainer>
        <DataBroadcastingRemote
            v-if="isEnabledDataBroadcasting === true"
            :isUsingNumericKey="isDataBroadcastingUsingNumericKey"
            :isLoading="isDataBroadcastingLoading"
            @key="onDataBroadcastingKey"
        ></DataBroadcastingRemote>
        <v-alert v-if="videoParam === null && notFound === true" type="error" variant="tonal">保存済み動画が見つかりません。</v-alert>
        <template #panel>
            <WatchSidePanel :tabs="panelTabs">
                <template #program><WatchPanelProgram :info="displayInfo"></WatchPanelProgram></template>
                <template #comment>
                    <WatchPanelComments :comments="jikkyoComments" :errorMessage="jikkyoErrorMessage"></WatchPanelComments>
                </template>
                <template #sns>
                    <SnsPostPanel ref="snsPostPanel" :programInfo="snsProgramInfo" :isLive="false"></SnsPostPanel>
                </template>
            </WatchSidePanel>
        </template>
    </WatchLayout>
</template>

<script lang="ts">
import WatchLayout from '@/components/watch/WatchLayout.vue';
import WatchPanelProgram from '@/components/watch/WatchPanelProgram.vue';
import WatchPanelComments from '@/components/watch/WatchPanelComments.vue';
import WatchSidePanel from '@/components/watch/WatchSidePanel.vue';
import WatchTopBar from '@/components/watch/WatchTopBar.vue';
import DataBroadcastingRemote from '@/components/dataBroadcasting/DataBroadcastingRemote.vue';
import SnsPostPanel, { SnsPostProgramInfo } from '@/components/watch/sns/SnsPostPanel.vue';
import VideoContainer from '@/components/video/VideoContainer.vue';
import type { ScreenshotRequest } from '@/components/video/BaseVideo';
import * as VideoParam from '@/components/video/ViedoParam';
import OfflineVideos from '@/services/OfflineVideos';
import { OfflineVideoRecord } from '@/services/OfflineVideoStorage';
import container from '@/model/ModelContainer';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IOfflineVideoState from '@/model/state/offline/IOfflineVideoState';
import {
    createOfflinePlaybackPosition,
    createOfflinePlaybackPositionKey,
    getOfflineVideoDurationSeconds,
    normalizeOfflinePlaybackPosition,
    restoreOfflinePlaybackPosition,
} from '../../../src/util/OfflinePlaybackUtil';
import {
    createOfflineDataBroadcastingInfo,
    createOfflineProgramInfo,
    getOfflineVideoKey,
    OfflineProgramInfo,
    resolveOfflineWatchReturnPath,
} from '../../../src/util/OfflineUxUtil';
import GenreUtil from '@/util/GenreUtil';
import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import IChannelModel from '@/model/channels/IChannelModel';
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import { JikkyoComment } from '@/util/JikkyoCommentClient';
import { resolveJikkyoKakologParam } from '@/util/JikkyoKakologParam';
import { resolveOfflineJikkyoParam } from '../../../src/util/OfflineJikkyoParam';
import type { OfflineJikkyoParam } from '../../../src/util/OfflineJikkyoParam';
import DataBroadcastingManager from '@/util/DataBroadcastingManager';
import { isFeatureEnabled } from '@/util/FeatureFlags';
import { ISettingStorageModel, WatchSidePanelTab } from '@/model/storage/setting/ISettingStorageModel';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import { AribKeyCode } from 'web-bml';
import { markRaw } from 'vue';
import { Component, Vue, toNative } from 'vue-facing-decorator';

interface PlaybackPositionUpdate {
    position: number;
    duration: number;
}

@Component({ components: { WatchLayout, WatchTopBar, WatchSidePanel, WatchPanelProgram, WatchPanelComments, VideoContainer, DataBroadcastingRemote, SnsPostPanel } })
class OfflineVideoWatch extends Vue {
    private offlineState: IOfflineVideoState = container.get<IOfflineVideoState>('IOfflineVideoState');
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    public video: OfflineVideoRecord | null = null;
    public notFound = false;
    public videoParam: VideoParam.OfflineHLSVideoParam | VideoParam.OfflineOriginalMpeg2Param | null = null;
    public displayInfo: OfflineProgramInfo = { channelId: null, name: '録画番組' };
    public jikkyoComments: JikkyoComment[] = [];
    public jikkyoErrorMessage: string | null = null;
    private positionKey = '';
    private recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    private channelModel = container.get<IChannelModel>('IChannelModel');
    private videoApiModel = container.get<IVideoApiModel>('IVideoApiModel');
    private serverConfigModel = container.get<IServerConfigModel>('IServerConfigModel');
    private settingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private dataBroadcastingManager: DataBroadcastingManager | null = null;
    public isOnline = navigator.onLine !== false;
    public isDataBroadcastingUsingNumericKey = false;
    public isDataBroadcastingLoading = false;

    private static readonly JIKKYO_COMMENT_LIMIT = 500;

    get videoKey(): string { return this.video === null ? 'none' : getOfflineVideoKey(this.video); }
    get returnPath(): string {
        const origin = typeof this.$route.query.from === 'string' ? this.$route.query.from : undefined;
        const recordedId = (this.video?.program as { id?: unknown } | undefined)?.id;
        return resolveOfflineWatchReturnPath(origin, this.videoKey, typeof recordedId === 'number' ? recordedId : undefined);
    }
    get panelTabs(): WatchSidePanelTab[] {
        const tabs: WatchSidePanelTab[] = this.videoParam?.jikkyoChannelId !== undefined && this.videoParam.jikkyoStartAt !== undefined && this.videoParam.jikkyoEndAt !== undefined
            ? ['program', 'comment']
            : ['program'];
        if (this.isOnline === true && this.settingStorageModel.tmp.isEnableSnsPanel === true) tabs.push('sns');
        return tabs;
    }

    get isDataBroadcastingAvailable(): boolean {
        return this.isOnline === true && isFeatureEnabled(this.serverConfigModel.getConfig(), 'dataBroadcasting') === true && createOfflineDataBroadcastingInfo(this.video ?? { videoId: -1, program: {} }, true) !== null;
    }

    get isEnabledDataBroadcasting(): boolean {
        return this.isDataBroadcastingAvailable === true && this.settingStorageModel.tmp.isEnableDataBroadcasting === true;
    }

    get snsProgramInfo(): SnsPostProgramInfo {
        return {
            channelName: this.displayInfo.channelName ?? '',
            name: this.displayInfo.name,
            description: this.displayInfo.description,
            extended: this.displayInfo.extended,
        };
    }

    public async mounted(): Promise<void> {
        window.addEventListener('online', this.onNetworkOnline);
        window.addEventListener('offline', this.onNetworkOffline);
        try {
            await this.setup();
        } finally {
            await this.scrollState.emitDoneGetData();
        }
    }

    private async setup(): Promise<void> {
        await this.offlineState.load().catch(error => console.error('offline watch load error', error));
        const key = typeof this.$route.params.key === 'string' ? this.$route.params.key : '';
        this.video = this.offlineState.find(key);
        if (this.video === null) {
            // 削除済み・別端末で保存したデータの URL を開いたとき、空の画面にしない
            this.notFound = true;
            return;
        }
        this.displayInfo = (this.video.programInfo as OfflineProgramInfo | undefined) ?? createOfflineProgramInfo(this.video.program, {
            videoFileId: this.video.videoId,
            resolveGenre: (genre, subGenre) => GenreUtil.getGenres(genre, subGenre),
        });
        this.positionKey = createOfflinePlaybackPositionKey(getOfflineVideoKey(this.video));
        const isOnline = navigator.onLine !== false;
        let serverParam: OfflineJikkyoParam | null = null;
        if (
            isOnline === true &&
            (typeof this.video.jikkyoChannelId !== 'string' ||
                typeof this.video.jikkyoStartAt !== 'number' ||
                typeof this.video.jikkyoEndAt !== 'number' ||
                this.video.jikkyoStartAt >= this.video.jikkyoEndAt)
        ) {
            const recordedId = (this.video.program as { id?: unknown }).id;
            if (typeof recordedId === 'number') {
                serverParam = await resolveJikkyoKakologParam({
                    recordedApiModel: this.recordedApiModel,
                    channelModel: this.channelModel,
                    videoApiModel: this.videoApiModel,
                    recordedId,
                    videoFileId: this.video.videoId,
                });
            }
        }
        const jikkyo = resolveOfflineJikkyoParam(this.video, isOnline, serverParam);
        if (jikkyo.source === 'server') {
            try {
                this.video = await OfflineVideos.updateJikkyoParam(this.video, jikkyo.param);
            } catch (error) {
                // 書き戻せなくても今回の再生と実況表示は続ける (次回の再生で再解決する)
                console.error('offline jikkyo parameter write-back error', error);
            }
        }
        const duration = getOfflineVideoDurationSeconds(this.video);
        const dataBroadcasting = createOfflineDataBroadcastingInfo(this.video, this.isOnline);
        let saved: string | null = null;
        try {
            saved = localStorage.getItem(this.positionKey);
        } catch (error) {
            // プライベートブラウズ等で localStorage が使えなくても再生は続ける
            console.error('offline playback position read error', error);
        }
        const position = restoreOfflinePlaybackPosition(saved, duration);
        const common = {
            durationSeconds: duration,
            chapters: this.video.chapters,
            ...(position === null ? {} : { playPosition: position }),
            ...(dataBroadcasting === null ? {} : {
                offlineDataBroadcastingVideoFileId: dataBroadcasting.videoFileId,
                offlineDataBroadcastingFileSize: dataBroadcasting.fileSize,
                offlineDataBroadcastingStartAt: dataBroadcasting.startAt ?? undefined,
            }),
        };
        this.videoParam = this.video.kind === 'original-mpeg2'
            ? { type: 'OfflineOriginalMpeg2', src: this.video.originalURL ?? this.video.playlistURL, ...common, ...jikkyo.param }
            : { type: 'OfflineHLS', src: OfflineVideos.getPlaylistURL(this.video), ...common, ...jikkyo.param };
    }

    public onNetworkOnline(): void {
        this.isOnline = true;
        if (this.isEnabledDataBroadcasting === true) void this.setupDataBroadcasting();
    }

    public onNetworkOffline(): void {
        this.isOnline = false;
        void this.teardownDataBroadcasting();
    }

    public onScreenshotRequest(request: ScreenshotRequest): void {
        (this.$refs.snsPostPanel as InstanceType<typeof SnsPostPanel> | undefined)?.onScreenshotRequest(request);
    }

    public onDataBroadcastingToggle(): void {
        this.settingStorageModel.tmp.isEnableDataBroadcasting = !this.settingStorageModel.tmp.isEnableDataBroadcasting;
        this.settingStorageModel.save();
        void this.setupDataBroadcasting();
    }

    public onVideoCanplay(): void {
        void this.setupDataBroadcasting();
    }

    public onDataBroadcastingSeek(): void {
        void this.setupDataBroadcasting();
    }

    private async setupDataBroadcasting(): Promise<void> {
        await this.teardownDataBroadcasting();
        if (this.isEnabledDataBroadcasting === false) return;

        const videoContainer = this.$refs.videoContainer as InstanceType<typeof VideoContainer> | undefined;
        const context = videoContainer?.getDataBroadcastingContext();
        if (context === null || typeof context === 'undefined') return;

        const manager = markRaw(new DataBroadcastingManager(context.dp, context.param, {
            getBroadcastTime: context.getBroadcastTime,
            onUsedKeyListChanged: isUsing => { this.isDataBroadcastingUsingNumericKey = isUsing; },
            onLoadingChanged: loading => { this.isDataBroadcastingLoading = loading; },
        }));
        this.dataBroadcastingManager = manager;
        try {
            await manager.init();
        } catch (error) {
            console.error('offline data broadcasting setup error', error);
            if (this.dataBroadcastingManager === manager) {
                this.dataBroadcastingManager = null;
                await manager.destroy().catch(destroyError => console.error(destroyError));
            }
        }
    }

    private async teardownDataBroadcasting(): Promise<void> {
        this.isDataBroadcastingUsingNumericKey = false;
        this.isDataBroadcastingLoading = false;
        const manager = this.dataBroadcastingManager;
        this.dataBroadcastingManager = null;
        if (manager !== null) await manager.destroy().catch(error => console.error(error));
    }

    public onDataBroadcastingKey(keyCode: AribKeyCode): void {
        this.dataBroadcastingManager?.sendKey(keyCode);
    }

    public async beforeUnmount(): Promise<void> {
        window.removeEventListener('online', this.onNetworkOnline);
        window.removeEventListener('offline', this.onNetworkOffline);
        await this.teardownDataBroadcasting();
    }

    public onPlaybackPosition(update: PlaybackPositionUpdate): void {
        if (this.positionKey === '' || Number.isFinite(update.duration) === false || update.duration <= 0) return;
        const position = normalizeOfflinePlaybackPosition(update.position, update.duration);
        try {
            localStorage.setItem(this.positionKey, JSON.stringify(createOfflinePlaybackPosition(position, update.duration, Date.now())));
        } catch (error) {
            console.error('offline playback position save error', error);
        }
    }

    public onJikkyoComment(comment: JikkyoComment): void {
        this.jikkyoErrorMessage = null;
        this.jikkyoComments.push(comment);
        if (this.jikkyoComments.length > OfflineVideoWatch.JIKKYO_COMMENT_LIMIT) {
            this.jikkyoComments.splice(0, this.jikkyoComments.length - OfflineVideoWatch.JIKKYO_COMMENT_LIMIT);
        }
    }

    public onJikkyoError(_message: string): void {
        this.jikkyoErrorMessage = 'コメントを取得できません';
    }
}

export default toNative(OfflineVideoWatch);
</script>
