<template>
    <v-main>
        <TitleBar title="オフライン保存"></TitleBar>
        <v-container>
            <div v-if="storageEstimate !== null" class="text-caption text-medium-emphasis mb-3">
                使用量 {{ formatBytes(storageEstimate.usage) }} / 空き {{ formatBytes(Math.max(0, storageEstimate.quota - storageEstimate.usage)) }}
            </div>
            <v-alert v-if="videos.length === 0 && jobs.length === 0" type="info" variant="tonal">保存済みの録画番組はありません。</v-alert>
            <div v-else class="offline-list">
                <div
                    v-for="video in videos"
                    :key="video.key ?? `${video.videoId}-${video.generationId}`"
                    class="offline-item mb-2"
                    role="button"
                    tabindex="0"
                    @click="openInfo(video)"
                    @keydown.enter="openInfo(video)"
                >
                    <div class="offline-main">
                        <v-img v-if="video.thumbnailURLs?.length" :src="video.thumbnailURLs[0]" class="offline-thumbnail" cover></v-img>
                        <div v-else class="offline-thumbnail no-thumbnail">録画</div>
                        <div class="offline-text">
                            <div class="offline-title font-weight-bold">{{ programInfo(video).name }}</div>
                            <div class="offline-channel text-caption text-medium-emphasis">
                                <!-- v-img は flex の中で横に伸びるため、ロゴは固定サイズの img で出す -->
                                <img v-if="video.channelLogoURL" :src="video.channelLogoURL" class="offline-logo" alt="" />
                                <span class="offline-channel-text">{{ programSubtitle(video) }}</span>
                            </div>
                            <div class="text-caption text-medium-emphasis">{{ formatDuration(video) }} / {{ video.profileLabel ?? video.profile }} / {{ formatBytes(video.sizeBytes) }}</div>
                        </div>
                    </div>
                    <div class="offline-actions" @click.stop>
                        <v-btn color="primary" size="small" class="ma-1" prepend-icon="mdi-play" @click="play(video)">再生</v-btn>
                        <v-btn color="error" variant="text" size="small" class="ma-1" @click="remove(video)">削除</v-btn>
                    </div>
                </div>
                <div v-for="job in jobs" :key="`job-${job.videoId}`" class="offline-item mb-2">
                    <div class="offline-main">
                        <div class="offline-thumbnail no-thumbnail">保存中</div>
                        <div class="offline-text">
                            <div class="offline-title font-weight-bold">{{ job.programInfo.name }}</div>
                            <div class="text-caption text-medium-emphasis">{{ job.programInfo.channelName ?? '' }} / {{ job.profileLabel ?? job.profile }}</div>
                            <v-progress-linear class="mt-1" :model-value="jobProgress(job)" color="primary" height="4"></v-progress-linear>
                            <div class="text-caption">保存中 {{ jobProgress(job) }}% ({{ formatBytes(job.downloadedBytes) }} / {{ formatBytes(job.estimatedBytes) }})</div>
                        </div>
                    </div>
                </div>
            </div>
        </v-container>
    </v-main>
</template>

<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import OfflineVideos, { OfflineDownloadJob } from '@/services/OfflineVideos';
import { OfflineVideoRecord } from '@/services/OfflineVideoStorage';
import container from '@/model/ModelContainer';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IOfflineVideoState from '@/model/state/offline/IOfflineVideoState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Vue, toNative } from 'vue-facing-decorator';
import GenreUtil from '@/util/GenreUtil';
import Util from '@/util/Util';
import { createOfflineProgramInfo, getOfflineVideoKey, OfflineProgramInfo } from '../../../src/util/OfflineUxUtil';

interface StorageEstimateView {
    usage: number;
    quota: number;
}

@Component({ components: { TitleBar } })
class OfflineVideosView extends Vue {
    private offlineState: IOfflineVideoState = container.get<IOfflineVideoState>('IOfflineVideoState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    public jobs: OfflineDownloadJob[] = [];
    public storageEstimate: StorageEstimateView | null = null;

    get videos(): OfflineVideoRecord[] { return this.offlineState.videos; }

    public async mounted(): Promise<void> {
        try {
            await this.load();
            await this.loadStorageEstimate();
        } finally {
            // router の scrollBehavior はこの通知を待つ。送らないと 5 秒後に ScrollPositionDataTimeout が未処理の reject になる
            await this.scrollState.emitDoneGetData();
        }
        OfflineVideos.eventTarget.addEventListener('change', this.onOfflineVideosChanged);
    }

    public beforeUnmount(): void {
        OfflineVideos.eventTarget.removeEventListener('change', this.onOfflineVideosChanged);
    }

    private onOfflineVideosChanged(): void {
        this.jobs = OfflineVideos.getJobs();
        void this.load().then(() => this.loadStorageEstimate());
    }

    public async load(): Promise<void> {
        try {
            await this.offlineState.load();
            this.jobs = OfflineVideos.getJobs();
        } catch (error) {
            console.error('offline video list error', error);
            this.jobs = OfflineVideos.getJobs();
        }
    }

    private async loadStorageEstimate(): Promise<void> {
        const estimate = await navigator.storage?.estimate?.();
        if (estimate?.quota === undefined) return;
        this.storageEstimate = { usage: estimate.usage ?? 0, quota: estimate.quota };
    }

    public programInfo(video: OfflineVideoRecord): OfflineProgramInfo {
        return (video.programInfo as OfflineProgramInfo | undefined) ?? createOfflineProgramInfo(video.program, {
            videoFileId: video.videoId,
            resolveGenre: (genre, subGenre) => GenreUtil.getGenres(genre, subGenre),
        });
    }

    public programSubtitle(video: OfflineVideoRecord): string {
        const info = this.programInfo(video);
        return [info.channelName, info.time].filter(value => value !== undefined && value !== '').join(' / ');
    }

    public formatDuration(video: OfflineVideoRecord): string {
        if (video.durationSeconds !== undefined && Number.isFinite(video.durationSeconds) && video.durationSeconds > 0) return `${Math.floor(video.durationSeconds / 60)}分`;
        return this.programInfo(video).durationText ?? '長さ不明';
    }

    public formatBytes(bytes: number): string {
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
        return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
    }

    public jobProgress(job: OfflineDownloadJob): number {
        return job.estimatedBytes > 0 ? Math.min(100, Math.floor(job.downloadedBytes / job.estimatedBytes * 100)) : 0;
    }

    public openInfo(video: OfflineVideoRecord): void {
        void Util.move(this.$router, { path: `/offline-videos/${encodeURIComponent(getOfflineVideoKey(video))}` });
    }

    public play(video: OfflineVideoRecord): void {
        void Util.move(this.$router, { path: `/offline-videos/${encodeURIComponent(getOfflineVideoKey(video))}/watch`, query: { from: 'list' } });
    }

    public async remove(video: OfflineVideoRecord): Promise<void> {
        if (window.confirm('このオフライン保存を削除しますか？') === false) return;
        try {
            await this.offlineState.remove(video);
            await this.loadStorageEstimate();
        } catch (error) {
            this.snackbarState.open({ color: 'error', text: 'オフライン保存の削除に失敗しました' });
            console.error(error);
        }
    }
}

export default toNative(OfflineVideosView);
</script>

<style lang="sass" scoped>
.offline-item
    display: flex
    flex-wrap: wrap
    align-items: center
    gap: 4px 12px
    padding: 12px
    cursor: pointer
    border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity))
    border-radius: 4px

.offline-main
    display: flex
    align-items: center
    gap: 12px
    flex: 1 1 320px
    min-width: 0

.offline-thumbnail
    width: 144px
    height: 81px
    flex: 0 0 auto
    border-radius: 2px

.no-thumbnail
    display: flex
    align-items: center
    justify-content: center
    background: rgba(var(--v-theme-on-surface), 0.08)
    color: rgba(var(--v-theme-on-surface), 0.6)

.offline-text
    flex: 1 1 auto
    min-width: 0

.offline-title
    display: -webkit-box
    -webkit-line-clamp: 2
    -webkit-box-orient: vertical
    overflow: hidden
    word-break: break-all

.offline-channel
    display: flex
    align-items: center
    gap: 6px
    min-width: 0

.offline-logo
    flex: 0 0 auto
    width: 32px
    height: 18px
    object-fit: contain

.offline-channel-text
    min-width: 0

.offline-actions
    display: flex
    flex: 0 0 auto
    align-items: center
    margin-left: auto

// 狭い端末では操作ボタンを下の行へ回し、番組名と放送局を横幅いっぱいに使う
@media screen and (max-width: 600px)
    .offline-item
        padding: 8px

    .offline-main
        flex-basis: 100%
        align-items: flex-start

    .offline-thumbnail
        width: 112px
        height: 63px

    .offline-actions
        width: 100%
        justify-content: flex-end
</style>
