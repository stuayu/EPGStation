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
                    <v-list-item-title>{{ programName(video) }}</v-list-item-title>
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
            </v-card>
        </v-container>
    </v-main>
</template>

<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import VideoContainer from '@/components/video/VideoContainer.vue';
import * as VideoParam from '@/components/video/ViedoParam';
import OfflineVideos from '@/services/OfflineVideos';
import OfflineVideoStorage, { OfflineVideoRecord } from '@/services/OfflineVideoStorage';
import container from '@/model/ModelContainer';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import { Component, Vue, toNative } from 'vue-facing-decorator';

@Component({ components: { TitleBar, VideoContainer } })
class OfflineVideosView extends Vue {
    public videos: OfflineVideoRecord[] = [];
    public selected: OfflineVideoRecord | null = null;
    private scrollState = container.get<IScrollPositionState>('IScrollPositionState');

    get selectedParam(): VideoParam.OfflineHLSVideoParam | null {
        return this.selected === null ? null : { type: 'OfflineHLS', src: OfflineVideos.getPlaylistURL(this.selected) };
    }

    public async mounted(): Promise<void> {
        await this.load();
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

    public programName(video: OfflineVideoRecord): string {
        const program = video.program as { name?: string };
        return program.name ?? `録画 ${video.videoId}`;
    }

    public programSubtitle(video: OfflineVideoRecord): string {
        const program = video.program as { channelName?: string; startAt?: number };
        const date = typeof program.startAt === 'number' ? new Date(program.startAt).toLocaleString('ja-JP') : '';
        return [program.channelName, date].filter(value => value !== undefined && value !== '').join(' / ');
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
