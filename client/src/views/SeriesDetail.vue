<template>
    <v-main>
        <TitleBar :title="detail?.title || 'シリーズ詳細'"></TitleBar>
        <v-container v-if="detail">
            <v-select v-model="channelId" :items="channelItems" item-title="title" item-value="value" label="放送局で絞り込み" @update:model-value="load"></v-select>
            <v-list lines="three">
                <v-list-item v-for="item in detail.recorded" :key="item.recordedId" :to="`/recorded/detail/${item.recordedId}`">
                    <template #prepend>
                        <v-avatar color="primary">{{ item.episodeNumber ?? '-' }}</v-avatar>
                    </template>
                    <v-list-item-title>{{ episodeTitle(item) }}</v-list-item-title>
                    <v-list-item-subtitle>{{ item.channelName || item.channelId }} · {{ formatDate(item.startAt) }}</v-list-item-subtitle>
                    <template #append><v-chip v-if="item.airType === 'rerun'" color="orange" size="small">再放送</v-chip></template>
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
    private api = container.get<ISeriesApiModel>('ISeriesApiModel');
    get id() {
        return Number(this.$route.params.id);
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
    async load() {
        this.detail = await this.api.get(this.id, this.channelId ?? undefined);
    }
    episodeTitle(x: SeriesRecording) {
        const label = x.episodeLabel || x.episodeNumber !== null ? `第${x.episodeNumber}話` : '';
        return `${label} ${x.episodeTitle || x.recordedTitle}`.trim();
    }
    formatDate(value: number) {
        return new Date(value).toLocaleString();
    }
}
export default toNative(SeriesDetailView);
</script>
