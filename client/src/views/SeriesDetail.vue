<template>
    <v-main>
        <TitleBar :title="detail?.title || 'シリーズ詳細'"></TitleBar>
        <v-container v-if="detail">
            <div class="d-flex align-center mb-3">
                <v-chip v-if="detail.externalIds.annictId" color="green">Annict: {{ detail.externalIds.annictId }}</v-chip>
                <v-btn class="ml-2" variant="outlined" :loading="annictSyncing" @click="syncAnnict">Annict同期</v-btn>
            </div>
            <v-alert v-if="annictMessage" type="success" class="mb-3">{{ annictMessage }}</v-alert>
            <v-alert v-if="detail.continuity.missingEpisodes.length" type="warning" class="mb-3">欠番: {{ missingEpisodeText }}</v-alert>
            <v-alert v-if="detail.continuity.duplicateEpisodes.length" type="info" class="mb-3">複数録画・再放送: {{ duplicateEpisodeText }}</v-alert>
            <v-select v-model="channelId" :items="channelItems" item-title="title" item-value="value" label="放送局で絞り込み" @update:model-value="load"></v-select>
            <v-list lines="three">
                <v-list-item v-for="item in detail.recorded" :key="item.recordedId" :to="`/recorded/detail/${item.recordedId}`">
                    <template #prepend>
                        <v-avatar color="primary">{{ item.episodeNumber ?? '-' }}</v-avatar>
                    </template>
                    <v-list-item-title>{{ episodeTitle(item) }}</v-list-item-title>
                    <v-list-item-subtitle>{{ item.channelName || item.channelId }} · {{ formatDate(item.startAt) }}</v-list-item-subtitle>
                    <template #append>
                        <v-chip v-if="item.airType === 'rerun'" color="orange" size="small">再放送</v-chip>
                        <v-chip v-else-if="isDuplicate(item.recordedId)" color="blue" size="small">複数録画</v-chip>
                    </template>
                </v-list-item>
            </v-list>
            <v-alert v-if="detail.recorded.length === 0" type="info">この放送局の録画はありません</v-alert>
        </v-container>
    </v-main>
</template>
<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISeriesApiModel, { SeriesDetail as Detail, SeriesRecording } from '@/model/api/series/ISeriesApiModel';
import { Component, Vue, toNative } from 'vue-facing-decorator';
@Component({ components: { TitleBar } })
class SeriesDetailView extends Vue {
    detail: Detail | null = null;
    channelId: number | null = null;
    annictSyncing = false;
    annictMessage = '';
    private api = container.get<ISeriesApiModel>('ISeriesApiModel');
    get id() {
        return Number(this.$route.params.id);
    }
    get missingEpisodeText(): string {
        return this.detail?.continuity.missingEpisodes.map(x => `S${x.seasonNumber} 第${x.episodeNumber}話`).join('、') ?? '';
    }
    get duplicateEpisodeText(): string {
        return this.detail?.continuity.duplicateEpisodes.map(x => `S${x.seasonNumber} 第${x.episodeNumber}話 (${x.recordedIds.length}件)`).join('、') ?? '';
    }
    isDuplicate(recordedId: number): boolean {
        return this.detail?.continuity.duplicateEpisodes.some(x => x.recordedIds.includes(recordedId)) ?? false;
    }
    get channelItems() {
        return [
            { title: 'すべての放送局', value: null },
            ...(this.detail?.channels.map(x => ({ title: `${x.channelName || x.channelId} (${x.count})`, value: x.channelId })) || []),
        ];
    }
    mounted() {
        void this.load();
    }
    async syncAnnict(): Promise<void> {
        this.annictSyncing = true;
        this.annictMessage = '';
        try {
            const result = await this.api.syncAnnict(this.id);
            this.annictMessage = `Annict「${result.title}」に同期しました`;
            await this.load();
        } finally {
            this.annictSyncing = false;
        }
    }
    async load() {
        this.detail = await this.api.get(this.id, this.channelId ?? undefined);
    }
    episodeTitle(x: SeriesRecording) {
        const label = x.episodeLabel ?? (x.episodeNumber !== null ? `第${x.episodeNumber}話` : '');
        return `${label} ${x.episodeTitle || x.recordedTitle}`.trim();
    }
    formatDate(value: number) {
        return new Date(value).toLocaleString();
    }
}
export default toNative(SeriesDetailView);
</script>
