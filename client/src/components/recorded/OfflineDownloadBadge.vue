<template>
    <span class="offline-download-badge" @click.stop>
        <v-chip v-if="isDownloading" size="x-small" color="primary" variant="tonal">保存中</v-chip>
        <v-chip v-else-if="isSaved" size="x-small" color="success" variant="tonal">オフライン保存済み</v-chip>
        <template v-if="showPlay && savedVideos.length === 1">
            <v-btn size="x-small" variant="text" color="primary" class="ml-1" title="保存したデータで再生" @click.stop="play(savedVideos[0])">
                <v-icon start size="small">mdi-play</v-icon>保存データで再生
            </v-btn>
        </template>
        <v-menu v-else-if="showPlay && savedVideos.length > 1" location="bottom">
            <template #activator="{ props }">
                <v-btn v-bind="props" size="x-small" variant="text" color="primary" class="ml-1" title="保存したデータで再生" @click.stop>
                    <v-icon start size="small">mdi-play</v-icon>保存データで再生
                </v-btn>
            </template>
            <v-card class="menu-card">
                <v-card-title class="text-body-2">保存データを選択</v-card-title>
                <v-card-text class="menu-card-body pa-1">
                    <v-btn v-for="video in savedVideos" :key="video.key" block variant="text" class="justify-start" @click="play(video)">
                        {{ video.profileLabel ?? video.profile }} ({{ formatBytes(video.sizeBytes) }})
                    </v-btn>
                </v-card-text>
            </v-card>
        </v-menu>
    </span>
</template>

<script lang="ts">
import OfflineVideos from '@/services/OfflineVideos';
import type { OfflineVideoRecord } from '@/services/OfflineVideoStorage';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';

@Component({})
class OfflineDownloadBadge extends Vue {
    @Prop({ required: true })
    public videoId!: number;
    @Prop({ default: false })
    public showPlay!: boolean;
    @Prop({ default: undefined })
    public videoIds!: number[] | undefined;
    public isSaved = false;
    public isDownloading = false;
    public savedVideos: OfflineVideoRecord[] = [];

    public async mounted(): Promise<void> {
        await this.refresh().catch(error => console.error('offline video badge error', error));
        OfflineVideos.eventTarget.addEventListener('change', this.onOfflineVideosChanged);
    }

    public beforeUnmount(): void {
        OfflineVideos.eventTarget.removeEventListener('change', this.onOfflineVideosChanged);
    }

    private onOfflineVideosChanged(): void {
        void this.refresh().catch(error => console.error('offline video badge error', error));
    }

    public async refresh(): Promise<void> {
        this.isDownloading = OfflineVideos.getJob(this.videoId)?.state === 'Downloading';
        this.savedVideos = await OfflineVideos.getSavedVideos(this.videoIds ?? [this.videoId]);
        this.isSaved = this.savedVideos.length > 0;
    }

    public play(video: OfflineVideoRecord): void {
        this.$emit('play', video);
    }

    public formatBytes(bytes: number): string {
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
        return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
    }
}

export default toNative(OfflineDownloadBadge);
</script>
