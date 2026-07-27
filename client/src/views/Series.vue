<template>
    <v-main>
        <TitleBar title="シリーズ">
            <template v-slot:menu>
                <v-btn icon variant="text" size="small" :to="'/series/pending'" title="未確定キュー">
                    <v-icon>mdi-help-box-outline</v-icon>
                </v-btn>
                <v-btn icon variant="text" size="small" @click="openMergeDialog" title="マージ">
                    <v-icon>mdi-call-merge</v-icon>
                </v-btn>
            </template>
        </TitleBar>
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

        <v-dialog v-model="isOpenMergeDialog" max-width="600">
            <v-card>
                <v-card-title>シリーズのマージ</v-card-title>
                <v-card-text>
                    <v-select
                        v-model="mergeFromId"
                        :items="items.map(x => ({ title: x.title, value: x.id }))"
                        label="統合元シリーズ (このシリーズは消えます)"
                    ></v-select>
                    <v-text-field v-model="mergeToKeyword" label="統合先シリーズを検索" @keyup.enter="searchMergeTarget"></v-text-field>
                    <v-select v-model="mergeToId" :items="mergeToItems.map(x => ({ title: x.title, value: x.id }))" label="統合先シリーズ"></v-select>
                    <v-alert v-if="mergeFromId !== null && mergeFromId === mergeToId" type="warning">統合元と統合先が同じです</v-alert>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="isOpenMergeDialog = false">キャンセル</v-btn>
                    <v-btn
                        color="primary"
                        variant="text"
                        :disabled="mergeFromId === null || mergeToId === null || mergeFromId === mergeToId"
                        :loading="isOpenConfirmMergeDialog === false && merging"
                        @click="isOpenConfirmMergeDialog = true"
                        >マージ</v-btn
                    >
                </v-card-actions>
            </v-card>
        </v-dialog>

        <v-dialog v-model="isOpenConfirmMergeDialog" max-width="500">
            <v-card>
                <v-card-title>マージの確認</v-card-title>
                <v-card-text>
                    統合元シリーズを統合先シリーズへ統合します。統合元シリーズに紐づく録画はすべて統合先シリーズに移動し、統合元シリーズは削除されます。この操作は取り消せません。よろしいですか？
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="isOpenConfirmMergeDialog = false">キャンセル</v-btn>
                    <v-btn color="error" variant="text" :loading="merging" @click="executeMerge">実行する</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </v-main>
</template>
<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISeriesApiModel, { SeriesListItem } from '@/model/api/series/ISeriesApiModel';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Vue, toNative } from 'vue-facing-decorator';
@Component({ components: { TitleBar } })
class SeriesView extends Vue {
    keyword = '';
    items: SeriesListItem[] = [];
    total = 0;
    offset = 0;
    limit = 30;
    loading = false;

    isOpenMergeDialog = false;
    isOpenConfirmMergeDialog = false;
    mergeFromId: number | null = null;
    mergeToKeyword = '';
    mergeToId: number | null = null;
    mergeToItems: SeriesListItem[] = [];
    merging = false;

    private api = container.get<ISeriesApiModel>('ISeriesApiModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

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

    openMergeDialog(): void {
        this.mergeFromId = null;
        this.mergeToId = null;
        this.mergeToKeyword = '';
        this.mergeToItems = this.items;
        this.isOpenMergeDialog = true;
    }

    async searchMergeTarget(): Promise<void> {
        const x = await this.api.list(this.mergeToKeyword, 0, 100);
        this.mergeToItems = x.items;
    }

    async executeMerge(): Promise<void> {
        if (this.mergeFromId === null || this.mergeToId === null) {
            return;
        }
        this.merging = true;
        try {
            await this.api.merge(this.mergeFromId, this.mergeToId);
            this.snackbarState.open({ color: 'success', text: 'シリーズをマージしました' });
            this.isOpenConfirmMergeDialog = false;
            this.isOpenMergeDialog = false;
            await this.load();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'マージに失敗しました' });
        } finally {
            this.merging = false;
        }
    }
}
export default toNative(SeriesView);
</script>
