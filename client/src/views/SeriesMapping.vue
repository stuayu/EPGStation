<template>
    <v-main>
        <TitleBar title="シリーズ割当を修正"></TitleBar>
        <v-container>
            <v-card class="mx-auto" max-width="800">
                <v-card-text>
                    <v-alert v-if="recorded" type="info" class="mb-4">{{ recorded.name }}</v-alert>
                    <v-switch v-model="createNew" label="新しいシリーズを作成"></v-switch>
                    <v-text-field v-if="createNew" v-model="newTitle" label="新しいシリーズ名"></v-text-field>
                    <template v-else>
                        <v-text-field v-model="keyword" label="シリーズを検索" @keyup.enter="search"></v-text-field>
                        <v-select v-model="seriesId" :items="seriesItems" item-title="title" item-value="id" label="割当先シリーズ"></v-select>
                    </template>
                    <v-row>
                        <v-col><v-text-field v-model.number="seasonNumber" type="number" min="1" label="シーズン"></v-text-field></v-col>
                        <v-col><v-text-field v-model.number="episodeNumber" type="number" min="0" step="0.5" label="話数"></v-text-field></v-col>
                    </v-row>
                    <v-select v-model="airType" :items="airTypes" item-title="title" item-value="value" label="放送種別"></v-select>
                    <v-alert v-if="current" type="success" class="mb-3">
                        現在: {{ current.seriesTitle }} / {{ current.episodeNumber ?? '話数なし' }}（{{ current.matchMethod }}）
                    </v-alert>
                    <v-btn color="primary" :loading="saving" @click="save">手動割当を保存</v-btn>
                    <v-btn class="ml-2" color="error" variant="outlined" @click="remove">割当を解除</v-btn>
                </v-card-text>
            </v-card>
        </v-container>
    </v-main>
</template>
<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import ISeriesApiModel, { SeriesListItem, SeriesMapping as Mapping } from '@/model/api/series/ISeriesApiModel';
import { Component, Vue, toNative } from 'vue-facing-decorator';
import * as apid from '../../../api';
@Component({ components: { TitleBar } })
class SeriesMappingView extends Vue {
    recorded: apid.RecordedItem | null = null;
    current: Mapping | null = null;
    seriesItems: SeriesListItem[] = [];
    seriesId: number | null = null;
    keyword = '';
    createNew = false;
    newTitle = '';
    seasonNumber = 1;
    episodeNumber: number | null = null;
    airType = 'unknown';
    saving = false;
    airTypes = [
        { title: '不明', value: 'unknown' },
        { title: '初回放送', value: 'first' },
        { title: '再放送', value: 'rerun' },
        { title: '遅れ放送', value: 'delayed' },
    ];
    private seriesApi = container.get<ISeriesApiModel>('ISeriesApiModel');
    private recordedApi = container.get<IRecordedApiModel>('IRecordedApiModel');
    get id() {
        return Number(this.$route.params.id);
    }
    async mounted() {
        this.recorded = await this.recordedApi.get(this.id, false);
        this.newTitle = this.recorded.name;
        this.current = await this.seriesApi.getMapping(this.id);
        if (this.current) {
            this.seriesId = this.current.seriesId;
            this.seasonNumber = this.current.seasonNumber ?? 1;
            this.episodeNumber = this.current.episodeNumber;
            this.airType = this.current.airType;
        }
        await this.search();
    }
    async search() {
        const x = await this.seriesApi.list(this.keyword, 0, 100);
        this.seriesItems = x.items;
    }
    async save() {
        this.saving = true;
        try {
            this.current = await this.seriesApi.updateMapping(this.id, {
                seriesId: this.createNew ? undefined : (this.seriesId ?? undefined),
                seriesTitle: this.createNew ? this.newTitle : undefined,
                seasonNumber: this.seasonNumber,
                episodeNumber: this.episodeNumber,
                airType: this.airType,
            });
            this.$router.push(`/series/${this.current.seriesId}`);
        } finally {
            this.saving = false;
        }
    }
    async remove() {
        await this.seriesApi.removeMapping(this.id);
        this.current = null;
        this.$router.push(`/recorded/detail/${this.id}`);
    }
}
export default toNative(SeriesMappingView);
</script>
