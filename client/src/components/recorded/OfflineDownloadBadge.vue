<template>
    <span class="offline-download-badge" :class="{ 'is-large': large === true }" @click.stop>
        <v-chip v-if="isDownloading" class="offline-download-chip" size="x-small" color="primary" variant="tonal">
            保存中 {{ formatBytes(downloadJob?.downloadedBytes ?? 0) }} / {{ formatBytes(downloadJob?.estimatedBytes ?? 0) }}
        </v-chip>
        <v-chip v-else-if="isSaved && large !== true" size="x-small" color="success" variant="tonal">オフライン保存済み</v-chip>
        <template v-if="showPlay && savedVideos.length === 1">
            <v-btn
                :size="large === true ? 'default' : 'x-small'"
                :variant="large === true ? 'flat' : 'text'"
                color="primary"
                :class="large === true ? 'ma-1' : 'ml-1'"
                title="保存したデータで再生"
                @click.stop="play(savedVideos[0])"
            >
                <v-icon start :size="large === true ? undefined : 'small'">mdi-download-circle</v-icon>保存データで再生
            </v-btn>
        </template>
        <v-menu v-else-if="showPlay && savedVideos.length > 1" location="bottom">
            <template #activator="{ props }">
                <v-btn
                    v-bind="props"
                    :size="large === true ? 'default' : 'x-small'"
                    :variant="large === true ? 'flat' : 'text'"
                    color="primary"
                    :class="large === true ? 'ma-1' : 'ml-1'"
                    title="保存したデータで再生"
                    @click.stop
                >
                    <v-icon start :size="large === true ? undefined : 'small'">mdi-download-circle</v-icon>保存データで再生
                    <v-icon end>mdi-menu-down</v-icon>
                </v-btn>
            </template>
            <v-card class="menu-card offline-select-menu">
                <v-card-title class="text-body-2">保存データを選択</v-card-title>
                <v-card-text class="menu-card-body pa-1">
                    <v-list density="compact" class="pa-0">
                        <v-list-item v-for="video in savedVideos" :key="video.key" class="offline-select-item" @click="play(video)">
                            <v-list-item-title>{{ video.profileLabel ?? video.profile }}</v-list-item-title>
                            <!-- 同じ画質を複数保存していても見分けられるよう保存日時とサイズを出す -->
                            <v-list-item-subtitle>{{ formatSavedAt(video.savedAt) }} 保存 / {{ formatBytes(video.sizeBytes) }}</v-list-item-subtitle>
                        </v-list-item>
                    </v-list>
                </v-card-text>
            </v-card>
        </v-menu>
    </span>
</template>

<script lang="ts">
import OfflineVideos, { type OfflineDownloadJob } from '@/services/OfflineVideos';
import type { OfflineVideoRecord } from '@/services/OfflineVideoStorage';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';
import { formatBytes } from '../../../../src/util/ByteFormatUtil';

@Component({})
class OfflineDownloadBadge extends Vue {
    @Prop({ required: true })
    public videoId!: number;
    @Prop({ default: false })
    public showPlay!: boolean;
    // 録画詳細では再生ボタン群と同じ大きさで出す (小さなリンクだと見落とされる)
    @Prop({ default: false })
    public large!: boolean;
    @Prop({ default: undefined })
    public videoIds!: number[] | undefined;
    public isSaved = false;
    public isDownloading = false;
    public downloadJob: OfflineDownloadJob | null = null;
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
        const job = OfflineVideos.getJob(this.videoId);
        this.isDownloading = job?.state === 'Downloading';
        // job は保存中に同じオブジェクトを変更するため、描画用には毎回複製する。
        this.downloadJob = job?.state === 'Downloading' ? { ...job } : null;
        this.savedVideos = await OfflineVideos.getSavedVideos(this.videoIds ?? [this.videoId]);
        this.isSaved = this.savedVideos.length > 0;
    }

    public play(video: OfflineVideoRecord): void {
        this.$emit('play', video);
    }

    public formatSavedAt(savedAt: number): string {
        if (Number.isFinite(savedAt) === false || savedAt <= 0) return '';
        const date = new Date(savedAt);
        const pad = (value: number): string => value.toString(10).padStart(2, '0');
        return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    public formatBytes(bytes: number): string {
        return formatBytes(bytes);
    }
}

export default toNative(OfflineDownloadBadge);
</script>

<style lang="sass">
// v-menu の中身は body 直下へテレポートされるので scoped にしない (CLAUDE.md「スマホ・タブレット対応」)
.offline-select-menu
    width: 320px

.offline-download-badge
    display: inline-flex
    max-width: 100%
    min-width: 0

.offline-download-chip
    max-width: 100%

.offline-download-chip .v-chip__content
    min-width: 0
    max-width: 100%
    overflow: hidden
    text-overflow: ellipsis
    white-space: nowrap
</style>
