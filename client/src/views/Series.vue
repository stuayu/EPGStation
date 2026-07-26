<template>
    <v-main>
        <TitleBar title="シリーズ"></TitleBar>
        <v-container>
            <v-text-field v-model="keyword" label="シリーズを検索" clearable prepend-inner-icon="mdi-magnify" @keyup.enter="load"></v-text-field>
            <v-row>
                <v-col v-for="item in items" :key="item.id" cols="12" sm="6" md="4">
                    <v-card :to="`/series/${item.id}`" height="100%">
                        <v-card-title>{{ item.title }}</v-card-title>
                        <v-card-subtitle>{{ item.normalizedTitle }}</v-card-subtitle>
                        <v-card-actions>
                            <v-chip size="small">{{ item.mediaType }}</v-chip>
                        </v-card-actions>
                    </v-card>
                </v-col>
            </v-row>
            <v-alert v-if="!loading && items.length === 0" type="info">シリーズがありません</v-alert>
            <div class="d-flex justify-center mt-4">
                <v-btn :disabled="offset === 0" @click="previous">前へ</v-btn>
                <span class="pa-3">{{ offset + 1 }}–{{ Math.min(offset + limit, total) }} / {{ total }}</span>
                <v-btn :disabled="offset + limit >= total" @click="next">次へ</v-btn>
            </div>
        </v-container>
    </v-main>
</template>
<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISeriesApiModel, { SeriesListItem } from '@/model/api/series/ISeriesApiModel';
import { Component, Vue, toNative } from 'vue-facing-decorator';
@Component({ components: { TitleBar } })
class SeriesView extends Vue {
    keyword = '';
    items: SeriesListItem[] = [];
    total = 0;
    offset = 0;
    limit = 30;
    loading = false;
    private api = container.get<ISeriesApiModel>('ISeriesApiModel');
    mounted() {
        void this.load();
    }
    async load() {
        this.loading = true;
        try {
            const x = await this.api.list(this.keyword, this.offset, this.limit);
            this.items = x.items;
            this.total = x.total;
        } finally {
            this.loading = false;
        }
    }
    previous() {
        this.offset = Math.max(0, this.offset - this.limit);
        void this.load();
    }
    next() {
        this.offset += this.limit;
        void this.load();
    }
}
export default toNative(SeriesView);
</script>
