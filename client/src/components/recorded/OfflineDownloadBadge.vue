<template>
    <v-chip v-if="isDownloading" size="x-small" color="primary" variant="tonal">保存中</v-chip>
    <v-chip v-else-if="isSaved" size="x-small" color="success" variant="tonal">オフライン保存済み</v-chip>
</template>

<script lang="ts">
import OfflineVideos from '@/services/OfflineVideos';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';

@Component({})
class OfflineDownloadBadge extends Vue {
    @Prop({ required: true })
    public videoId!: number;
    public isSaved = false;
    public isDownloading = false;

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
        this.isSaved = (await OfflineVideos.getVideos()).some(video => video.videoId === this.videoId);
    }
}

export default toNative(OfflineDownloadBadge);
</script>
