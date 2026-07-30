<template>
    <v-main>
        <TitleBar title="シリーズ未確定キュー"></TitleBar>
        <v-container>
            <v-alert type="info" class="mb-3">確信度が低い、または候補が複数ある録画の一覧です。候補からワンクリックで割り当てるか、除外できます。</v-alert>
            <v-list lines="three">
                <v-list-item v-for="item in items" :key="item.id">
                    <v-list-item-title>{{ item.recordedTitle }}</v-list-item-title>
                    <v-list-item-subtitle>正規化タイトル: {{ item.normalizedTitle }}</v-list-item-subtitle>
                    <div class="d-flex flex-wrap mt-2">
                        <v-btn
                            v-for="candidate in item.candidates.slice(0, 3)"
                            :key="candidate.seriesId"
                            size="small"
                            class="mr-2 mb-2"
                            variant="outlined"
                            color="primary"
                            :loading="processingId === item.id"
                            @click="assign(item, candidate)"
                        >
                            {{ candidate.seriesTitle }} ({{ Math.round(candidate.score * 100) }}%)
                        </v-btn>
                        <v-btn size="small" class="mr-2 mb-2" variant="text" :to="`/recorded/${item.recordedId}/series-mapping`">手動で割り当てる</v-btn>
                        <v-btn size="small" class="mb-2" variant="text" color="error" :loading="processingId === item.id" @click="reject(item)">このシリーズにしない</v-btn>
                    </div>
                    <v-divider class="mt-2"></v-divider>
                </v-list-item>
            </v-list>
            <v-alert v-if="!loading && items.length === 0" type="success">未確定の録画はありません</v-alert>
            <div class="mt-4">
                <div class="text-center text-caption text-grey mb-1" v-if="total > 0">
                    {{ items.length === 0 ? 0 : offset + 1 }}–{{ Math.min(offset + limit, total) }} / {{ total }}
                </div>
                <v-pagination
                    v-if="totalPages > 1"
                    v-model="page"
                    :circle="false"
                    :length="totalPages"
                    :total-visible="7"
                    @update:model-value="onMovePage"
                ></v-pagination>
            </div>
        </v-container>
    </v-main>
</template>
<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISeriesApiModel, { SeriesPendingMatchItem } from '@/model/api/series/ISeriesApiModel';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Vue, toNative } from 'vue-facing-decorator';
import * as apid from '../../../api';

@Component({ components: { TitleBar } })
class SeriesPendingView extends Vue {
    items: SeriesPendingMatchItem[] = [];
    total = 0;
    offset = 0;
    limit = 30;
    loading = false;
    processingId: number | null = null;
    private api = container.get<ISeriesApiModel>('ISeriesApiModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    mounted() {
        void this.load();
    }

    async load() {
        this.loading = true;
        try {
            const x = await this.api.listPending(this.offset, this.limit);
            this.items = x.items;
            this.total = x.total;
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '未確定キューの取得に失敗しました' });
        } finally {
            this.loading = false;
        }
    }

    async assign(item: SeriesPendingMatchItem, candidate: { seriesId: number; seriesTitle: string; score: number }): Promise<void> {
        this.processingId = item.id;
        try {
            await this.api.confirmPending(item.id, {
                seriesId: candidate.seriesId,
                seasonNumber: 1,
                episodeNumber: null,
                airType: 'unknown' as apid.SeriesAirType,
            });
            this.snackbarState.open({
                color: 'success',
                text: `「${item.recordedTitle}」を「${candidate.seriesTitle}」に割り当てました`,
                action: {
                    text: '元に戻す',
                    onClick: async () => {
                        try {
                            await this.api.undoMapping(item.recordedId);
                            this.snackbarState.open({ color: 'success', text: '割り当てを元に戻しました' });
                        } catch (err) {
                            console.error(err);
                            this.snackbarState.open({ color: 'error', text: '元に戻す操作に失敗しました' });
                        }
                    },
                },
            });
            await this.load();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '割り当てに失敗しました' });
        } finally {
            this.processingId = null;
        }
    }

    async reject(item: SeriesPendingMatchItem): Promise<void> {
        this.processingId = item.id;
        try {
            await this.api.rejectPending(item.id);
            this.snackbarState.open({ color: 'success', text: 'このシリーズにしない設定にしました' });
            await this.load();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '除外に失敗しました' });
        } finally {
            this.processingId = null;
        }
    }

    /**
     * ページャの現在ページ (1 始まり)
     */
    get page(): number {
        return Math.floor(this.offset / this.limit) + 1;
    }
    set page(value: number) {
        this.offset = Math.max(0, (value - 1) * this.limit);
    }

    get totalPages(): number {
        return this.total === 0 ? 1 : Math.ceil(this.total / this.limit);
    }

    onMovePage(): void {
        void this.load();
    }
}
export default toNative(SeriesPendingView);
</script>
