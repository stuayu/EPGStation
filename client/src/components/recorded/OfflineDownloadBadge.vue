<template>
    <span class="offline-download-badge" @click.stop>
        <v-chip v-if="isDownloading" size="x-small" color="primary" variant="tonal">保存中</v-chip>
        <v-chip v-else-if="isSaved" size="x-small" color="success" variant="tonal">オフライン保存済み</v-chip>
        <v-btn v-if="showPlay && savedVideo !== null" size="x-small" variant="text" color="primary" class="ml-1" title="保存したデータで再生" @click.stop="play">
            <v-icon start size="small">mdi-play</v-icon>保存データで再生
        </v-btn>
    </span>
</template>

<script lang="ts">
import OfflineVideos from '@/services/OfflineVideos';
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
    public savedVideo: Awaited<ReturnType<typeof OfflineVideos.getSavedVideo>> = null;

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
        this.savedVideo = await OfflineVideos.getSavedVideo(this.videoIds ?? [this.videoId]);
        this.isSaved = this.savedVideo !== null;
    }

    public play(): void {
        if (this.savedVideo !== null) this.$emit('play', this.savedVideo);
    }
}

export default toNative(OfflineDownloadBadge);
</script>
