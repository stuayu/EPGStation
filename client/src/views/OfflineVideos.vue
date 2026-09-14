<template>
    <v-main>
        <TitleBar title="オフライン保存"></TitleBar>
        <v-container>
            <v-alert v-if="videos.length === 0 && selected === null" type="info" variant="tonal">
                保存済みの録画番組はありません。
            </v-alert>
            <v-list v-else lines="two">
                <v-list-item v-for="video in videos" :key="`${video.videoId}-${video.generationId}`">
                    <template #prepend>
                        <v-img v-if="video.thumbnailURLs?.length" :src="video.thumbnailURLs[0]" width="96" height="54" cover></v-img>
                    </template>
                    <v-list-item-title>{{ programInfo(video).name }}</v-list-item-title>
                    <v-list-item-subtitle>{{ programSubtitle(video) }} / {{ video.profile }} / {{ formatBytes(video.sizeBytes) }}</v-list-item-subtitle>
                    <template #append>
                        <v-btn class="ma-1" color="primary" :disabled="selected !== null" @click="play(video)">再生</v-btn>
                        <v-btn class="ma-1" color="error" variant="text" :disabled="selected !== null" @click="remove(video)">削除</v-btn>
                    </template>
                </v-list-item>
            </v-list>
            <v-progress-linear v-if="selected !== null" class="mt-4" indeterminate></v-progress-linear>
            <v-card v-if="selected !== null" class="mt-4">
                <VideoContainer :key="`${selected.videoId}-${selected.generationId}`" :video-param="selectedParam"></VideoContainer>
                <div class="pa-3 offline-program-info">
                    <div class="d-flex align-center mb-2">
                        <v-img v-if="selected.channelLogoURL" :src="selected.channelLogoURL" width="42" height="24" contain class="mr-2"></v-img>
                        <div class="text-subtitle-1 font-weight-bold">番組情報</div>
                    </div>
                    <WatchPanelProgram :info="selectedInfo"></WatchPanelProgram>
                </div>
            </v-card>
        </v-container>
    </v-main>
</template>

<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import VideoContainer from '@/components/video/VideoContainer.vue';
import WatchPanelProgram from '@/components/watch/WatchPanelProgram.vue';
import * as VideoParam from '@/components/video/ViedoParam';
import OfflineVideos from '@/services/OfflineVideos';
import OfflineVideoStorage, { OfflineVideoRecord } from '@/services/OfflineVideoStorage';
import container from '@/model/ModelContainer';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import { Component, Vue, toNative } from 'vue-facing-decorator';
import GenreUtil from '@/util/GenreUtil';
import { createOfflineProgramInfo, OfflineProgramInfo } from '../../../src/util/OfflineUxUtil';

@Component({ components: { TitleBar, VideoContainer, WatchPanelProgram } })
class OfflineVideosView extends Vue {
    public videos: OfflineVideoRecord[] = [];
    public selected: OfflineVideoRecord | null = null;
    private scrollState = container.get<IScrollPositionState>('IScrollPositionState');

    get selectedParam(): VideoParam.OfflineHLSVideoParam | VideoParam.OfflineOriginalMpeg2Param | null {
        if (this.selected === null) return null;
        return this.selected.kind === 'original-mpeg2'
            ? ({ type: 'OfflineOriginalMpeg2', src: this.selected.originalURL ?? this.selected.playlistURL } as VideoParam.OfflineOriginalMpeg2Param)
            : { type: 'OfflineHLS', src: OfflineVideos.getPlaylistURL(this.selected) };
    }
    get selectedInfo(): OfflineProgramInfo | null { return this.selected === null ? null : this.programInfo(this.selected); }

    public async mounted(): Promise<void> {
        await this.load();
        const requestedVideoId = Number(this.$route.query.videoId);
        if (Number.isSafeInteger(requestedVideoId)) this.selected = this.videos.find(video => video.videoId === requestedVideoId) ?? null;
        await this.scrollState.emitDoneGetData();
        OfflineVideos.eventTarget.addEventListener('change', this.onOfflineVideosChanged);
    }

    public beforeUnmount(): void {
        OfflineVideos.eventTarget.removeEventListener('change', this.onOfflineVideosChanged);
    }

    private onOfflineVideosChanged(): void {
        void this.load();
    }

    public async load(): Promise<void> {
        try {
            this.videos = await OfflineVideoStorage.getAll();
        } catch (error) {
            // IndexedDB の request.error が空のブラウザでも未処理 rejection にしない。
            console.error('offline video list error', error);
            this.videos = [];
        }
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

    public formatBytes(bytes: number): string {
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    }

    public play(video: OfflineVideoRecord): void {
        this.selected = video;
    }

    public async remove(video: OfflineVideoRecord): Promise<void> {
        await OfflineVideos.delete(video);
        if (this.selected?.videoId === video.videoId) this.selected = null;
        await this.load();
    }
}

export default toNative(OfflineVideosView);
</script>
