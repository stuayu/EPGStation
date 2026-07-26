<template>
    <v-card class="next-up-panel" variant="outlined">
        <v-card-title class="d-flex align-center justify-space-between">
            <span>Next Up</span>
            <v-btn v-if="data?.currentSeriesId !== null" size="small" variant="text" @click="moveSeries">シリーズへ</v-btn>
        </v-card-title>
        <v-tabs v-model="tab" density="comfortable">
            <v-tab value="latest">最新</v-tab>
            <v-tab value="series">シリーズ</v-tab>
        </v-tabs>
        <v-window v-model="tab">
            <v-window-item value="latest">
                <v-list lines="two" density="compact">
                    <v-list-item v-for="item in data?.latest ?? []" :key="`latest-${item.id}`">
                        <v-list-item-title>{{ item.name }}</v-list-item-title>
                        <v-list-item-subtitle>{{ item.channelName || item.channelId }} · {{ formatDate(item.startAt) }}</v-list-item-subtitle>
                        <template #append>
                            <v-chip v-if="watchStatus(item)" size="x-small" class="mr-2">{{ watchStatus(item) }}</v-chip>
                            <v-btn size="small" variant="text" @click="play(item)">再生</v-btn>
                        </template>
                    </v-list-item>
                </v-list>
            </v-window-item>
            <v-window-item value="series">
                <v-list lines="two" density="compact">
                    <v-list-item v-for="item in data?.series ?? []" :key="`series-${item.id}`">
                        <v-list-item-title>{{ item.name }}</v-list-item-title>
                        <v-list-item-subtitle>{{ item.channelName || item.channelId }} · {{ formatDate(item.startAt) }}</v-list-item-subtitle>
                        <template #append>
                            <v-chip v-if="watchStatus(item)" size="x-small" class="mr-2">{{ watchStatus(item) }}</v-chip>
                            <v-btn size="small" variant="text" @click="play(item)">再生</v-btn>
                        </template>
                    </v-list-item>
                </v-list>
            </v-window-item>
        </v-window>
        <v-card-text v-if="!loading && empty">候補がありません</v-card-text>
    </v-card>
</template>
<script lang="ts">
import container from '@/model/ModelContainer';
import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../../api';
@Component({})
class NextUpPanel extends Vue {
    @Prop({ required: true }) public recordedId!: apid.RecordedId;
    @Prop({ default: false }) public isHalfWidth!: boolean;
    @Prop({ default: null }) public streamingType!: string | null;
    @Prop({ default: null }) public mode!: number | null;
    data: { currentSeriesId: number | null; latest: apid.RecordedItem[]; series: apid.RecordedItem[] } | null = null;
    loading = false;
    tab = 'latest';
    private api = container.get<IRecordedApiModel>('IRecordedApiModel');
    get empty(): boolean {
        return (this.data?.latest.length ?? 0) === 0 && (this.data?.series.length ?? 0) === 0;
    }
    @Watch('recordedId', { immediate: true })
    async load(): Promise<void> {
        this.loading = true;
        try {
            this.data = await this.api.getNextUp(this.recordedId, this.isHalfWidth);
            if ((this.data?.series.length ?? 0) > 0) this.tab = 'series';
        } finally {
            this.loading = false;
        }
    }
    moveSeries(): void {
        const seriesId = this.data?.currentSeriesId;
        if (seriesId !== null && typeof seriesId !== 'undefined') void this.$router.push(`/series/${seriesId}`);
    }
    private pickVideo(item: apid.RecordedItem): apid.VideoFile | null {
        return item.videoFiles?.find(x => x.type === 'encoded') ?? item.videoFiles?.[0] ?? null;
    }
    play(item: apid.RecordedItem): void {
        const video = this.pickVideo(item);
        if (video === null) {
            void this.$router.push(`/recorded/detail/${item.id}`);
            return;
        }
        if (video.type === 'encoded' && (this.streamingType === null || this.mode === null)) {
            void this.$router.push({ path: '/recorded/watch', query: { videoId: String(video.id), recordedId: String(item.id) } });
            return;
        }
        if (this.streamingType !== null && this.mode !== null) {
            void this.$router.push({ path: `/recorded/streaming/${video.id}`, query: { recordedId: String(item.id), streamingType: this.streamingType, mode: String(this.mode) } });
            return;
        }
        void this.$router.push(`/recorded/detail/${item.id}`);
    }
    watchStatus(item: apid.RecordedItem): string | null {
        const status = item.videoFiles?.find(x => typeof x.watchHistory !== 'undefined')?.watchHistory?.status;
        if (status === 'watched') return '視聴済み';
        if (status === 'watching') return '視聴中';
        return null;
    }
    formatDate(value: number): string {
        return new Date(value).toLocaleString();
    }
}
export default toNative(NextUpPanel);
</script>
<style lang="sass" scoped>
.next-up-panel
    width: 360px
    max-width: 100%
</style>
