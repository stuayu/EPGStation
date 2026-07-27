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
                <v-btn icon variant="text" size="small" :loading="refreshing" @click="refreshMetadata" title="クール・読み仮名を作品辞書から再取得">
                    <v-icon>mdi-refresh</v-icon>
                </v-btn>
            </template>
        </TitleBar>
        <v-container>
            <v-text-field v-model="keyword" label="シリーズを検索" clearable prepend-inner-icon="mdi-magnify" @keyup.enter="reload"></v-text-field>

            <v-alert v-if="seasons.length === 0 && !loading" type="info" density="compact" class="mb-2">
                クール情報がまだありません。右上の
                <v-icon size="small">mdi-refresh</v-icon>
                (メタデータ再取得) を実行すると、作品辞書からクール・読み仮名・総話数を取り込んでクール絞り込みとあいうえお順が使えるようになります。
                <span class="text-caption">(サーバ起動から 10 分後にも自動で実行されます)</span>
            </v-alert>
            <div class="d-flex align-center ga-2 flex-wrap mb-2">
                <v-select
                    v-model="sort"
                    :items="sortItems"
                    item-title="title"
                    label="並べ替え"
                    density="compact"
                    hide-details
                    style="max-width: 200px"
                    v-on:update:model-value="reload"
                ></v-select>
                <v-btn
                    icon
                    variant="text"
                    size="small"
                    :title="order === 'asc' ? '昇順' : '降順'"
                    @click="toggleOrder"
                >
                    <v-icon>{{ order === 'asc' ? 'mdi-sort-ascending' : 'mdi-sort-descending' }}</v-icon>
                </v-btn>
                <v-select
                    v-model="season"
                    :items="seasonItems"
                    item-title="title"
                    :label="seasons.length === 0 ? 'クール (未取得)' : 'クール'"
                    :disabled="seasons.length === 0"
                    :hint="seasons.length === 0 ? 'クール情報がありません' : undefined"
                    density="compact"
                    hide-details
                    clearable
                    style="max-width: 220px"
                    v-on:update:model-value="reload"
                ></v-select>
                <v-select
                    v-model="status"
                    :items="statusItems"
                    item-title="title"
                    label="放送状態"
                    density="compact"
                    hide-details
                    clearable
                    style="max-width: 160px"
                    v-on:update:model-value="reload"
                ></v-select>
                <v-checkbox v-model="hasMissing" label="欠番あり" density="compact" hide-details v-on:update:model-value="reload"></v-checkbox>
                <v-spacer></v-spacer>
                <v-btn-toggle v-model="viewMode" density="compact" mandatory divided v-on:update:model-value="saveViewMode">
                    <v-btn value="grid" title="グリッド表示"><v-icon>mdi-view-grid</v-icon></v-btn>
                    <v-btn value="list" title="リスト表示"><v-icon>mdi-view-list</v-icon></v-btn>
                    <v-btn value="compact" title="コンパクト表示"><v-icon>mdi-format-list-bulleted</v-icon></v-btn>
                </v-btn-toggle>
            </div>

            <!-- グリッド表示 -->
            <v-row v-if="viewMode === 'grid'">
                <v-col v-for="item in items" :key="item.id" cols="12" sm="6" md="4">
                    <v-card :to="`/series/${item.id}`" height="100%" class="d-flex flex-column">
                        <!-- アイキャッチ画像 (Annict 作品辞書由来)。無い作品は代替表示にする -->
                        <v-img
                            v-if="item.hasImage"
                            :src="`./api/series/${item.id}/image`"
                            :alt="item.title"
                            :aspect-ratio="16 / 9"
                            cover
                            class="bg-grey-lighten-3"
                        >
                            <template v-slot:placeholder>
                                <div class="d-flex align-center justify-center fill-height">
                                    <v-progress-circular indeterminate size="24" color="grey"></v-progress-circular>
                                </div>
                            </template>
                            <template v-slot:error>
                                <div class="d-flex align-center justify-center fill-height">
                                    <v-icon size="40" color="grey">mdi-image-off-outline</v-icon>
                                </div>
                            </template>
                        </v-img>
                        <div v-else class="d-flex align-center justify-center bg-grey-lighten-3" :style="{ aspectRatio: '16 / 9' }">
                            <v-icon size="40" color="grey">mdi-television-classic</v-icon>
                        </div>
                        <v-card-title class="text-body-1">{{ item.title }}</v-card-title>
                        <v-card-subtitle class="pb-1">
                            {{ seasonText(item) }}
                            <span v-if="item.seasonSource === 'estimated'" class="text-caption text-grey" title="録画日時からの推測値です">(推定)</span>
                        </v-card-subtitle>
                        <v-card-text class="py-1">
                            <div class="d-flex align-center ga-1 flex-wrap mb-1">
                                <v-chip v-if="item.isOnAir" size="x-small" color="primary" variant="flat">放送中</v-chip>
                                <v-chip v-if="item.unwatchedCount > 0" size="x-small" color="info" variant="flat">未視聴 {{ item.unwatchedCount }}</v-chip>
                                <v-chip v-if="item.missingEpisodeCount > 0" size="x-small" color="warning" variant="flat" :title="`欠番 ${item.missingEpisodeCount} 話`">
                                    欠番 {{ item.missingEpisodeCount }}
                                </v-chip>
                                <v-chip v-if="item.duplicateEpisodeCount > 0" size="x-small" color="grey" variant="flat" title="同じ話数の録画が複数あります">
                                    重複 {{ item.duplicateEpisodeCount }}
                                </v-chip>
                            </div>
                            <v-progress-linear
                                :model-value="watchedPercent(item)"
                                height="4"
                                color="info"
                                bg-color="grey-lighten-2"
                                rounded
                            ></v-progress-linear>
                            <div class="text-caption text-grey mt-1">
                                {{ item.recordedCount - item.unwatchedCount }}/{{ item.recordedCount }} 視聴 ・ {{ fileSizeText(item.totalFileSize) }}
                            </div>
                        </v-card-text>
                        <v-spacer></v-spacer>
                        <v-card-actions class="pt-0">
                            <v-chip size="x-small">{{ item.mediaType }}</v-chip>
                            <v-btn icon variant="text" size="x-small" title="クール・読み仮名を編集" @click.prevent="openEditDialog(item)">
                                <v-icon size="small">mdi-pencil</v-icon>
                            </v-btn>
                            <v-spacer></v-spacer>
                            <v-icon v-if="item.imageSource === 'thumbnail'" size="x-small" color="grey" title="録画サムネイルを表示しています">
                                mdi-video-outline
                            </v-icon>
                            <span v-if="item.imageCopyright" class="text-caption text-grey text-truncate ml-1" :title="item.imageCopyright">
                                {{ item.imageCopyright }}
                            </span>
                        </v-card-actions>
                    </v-card>
                </v-col>
            </v-row>

            <!-- リスト表示: 左にサムネイル、右に情報 -->
            <v-card v-else-if="viewMode === 'list'" variant="flat">
                <v-list lines="two">
                    <v-list-item v-for="item in items" :key="item.id" :to="`/series/${item.id}`" class="px-2">
                        <template v-slot:prepend>
                            <v-img
                                v-if="item.hasImage"
                                :src="`./api/series/${item.id}/image`"
                                :alt="item.title"
                                width="120"
                                :aspect-ratio="16 / 9"
                                cover
                                class="rounded mr-3 bg-grey-lighten-3"
                            ></v-img>
                            <div v-else class="rounded mr-3 bg-grey-lighten-3 d-flex align-center justify-center" style="width: 120px; aspect-ratio: 16 / 9">
                                <v-icon color="grey">mdi-television-classic</v-icon>
                            </div>
                        </template>
                        <v-list-item-title>{{ item.title }}</v-list-item-title>
                        <v-list-item-subtitle>
                            {{ seasonText(item) }} ・ {{ item.recordedCount }} 件 ・ {{ fileSizeText(item.totalFileSize) }}
                        </v-list-item-subtitle>
                        <template v-slot:append>
                            <v-btn icon variant="text" size="small" title="クール・読み仮名を編集" @click.prevent="openEditDialog(item)">
                                <v-icon>mdi-pencil</v-icon>
                            </v-btn>
                        </template>
                        <div class="d-flex align-center ga-1 flex-wrap mt-1">
                            <v-chip v-if="item.isOnAir" size="x-small" color="primary" variant="flat">放送中</v-chip>
                            <v-chip v-if="item.unwatchedCount > 0" size="x-small" color="info" variant="flat">未視聴 {{ item.unwatchedCount }}</v-chip>
                            <v-chip v-if="item.missingEpisodeCount > 0" size="x-small" color="warning" variant="flat">欠番 {{ item.missingEpisodeCount }}</v-chip>
                            <v-chip v-if="item.duplicateEpisodeCount > 0" size="x-small" color="grey" variant="flat">重複 {{ item.duplicateEpisodeCount }}</v-chip>
                        </div>
                    </v-list-item>
                </v-list>
            </v-card>

            <!-- コンパクト表示: 画像なしの高密度一覧 -->
            <v-table v-else density="compact">
                <thead>
                    <tr>
                        <th>タイトル</th>
                        <th style="width: 110px">クール</th>
                        <th style="width: 90px">録画</th>
                        <th style="width: 90px">未視聴</th>
                        <th style="width: 90px">容量</th>
                        <th style="width: 120px">状態</th>
                        <th style="width: 48px"></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="item in items" :key="item.id" style="cursor: pointer" @click="$router.push(`/series/${item.id}`)">
                        <td class="text-truncate" style="max-width: 1px">{{ item.title }}</td>
                        <td>
                            {{ seasonText(item) }}
                            <span v-if="item.seasonSource === 'estimated'" class="text-caption text-grey">(推定)</span>
                        </td>
                        <td>{{ item.recordedCount }}</td>
                        <td>{{ item.unwatchedCount }}</td>
                        <td>{{ fileSizeText(item.totalFileSize) }}</td>
                        <td>
                            <v-chip v-if="item.isOnAir" size="x-small" color="primary" variant="flat">放送中</v-chip>
                            <v-chip v-if="item.missingEpisodeCount > 0" size="x-small" color="warning" variant="flat" class="ml-1">欠番</v-chip>
                        </td>
                        <td @click.stop>
                            <v-btn icon variant="text" size="x-small" title="クール・読み仮名を編集" @click="openEditDialog(item)">
                                <v-icon size="small">mdi-pencil</v-icon>
                            </v-btn>
                        </td>
                    </tr>
                </tbody>
            </v-table>
            <v-alert v-if="!loading && items.length === 0" type="info">シリーズがありません</v-alert>
            <div class="d-flex justify-center mt-4">
                <v-btn :disabled="offset === 0" @click="previous">前へ</v-btn>
                <span class="pa-3">{{ offset + 1 }}–{{ Math.min(offset + limit, total) }} / {{ total }}</span>
                <v-btn :disabled="offset + limit >= total" @click="next">次へ</v-btn>
            </div>
        </v-container>

        <v-dialog v-model="isOpenEditDialog" max-width="520">
            <v-card>
                <v-card-title>シリーズ情報の編集</v-card-title>
                <v-card-subtitle>{{ editTitle }}</v-card-subtitle>
                <v-card-text>
                    <v-alert v-if="editSeasonSource === 'estimated'" type="info" density="compact" class="mb-3">
                        現在のクールは<b>最古の録画日時からの推測値</b>です。保存すると手動設定として固定され、以降の自動補完で上書きされなくなります。
                    </v-alert>
                    <div class="d-flex ga-2">
                        <v-text-field v-model.number="editSeasonYear" type="number" label="年" density="compact" clearable></v-text-field>
                        <v-select v-model="editSeasonName" :items="seasonNameItems" item-title="title" label="季節" density="compact" clearable></v-select>
                    </div>
                    <v-text-field v-model="editTitleKana" label="読み仮名 (あいうえお順の並べ替えに使用)" density="compact" clearable></v-text-field>
                    <v-text-field v-model.number="editTotalEpisodes" type="number" label="総話数 (欠番検出に使用)" density="compact" clearable></v-text-field>
                    <v-alert v-if="editSeasonYear !== null && editSeasonName === null" type="warning" density="compact">
                        年と季節は両方指定してください (片方だけでは絞り込みに使えません)
                    </v-alert>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="isOpenEditDialog = false">キャンセル</v-btn>
                    <v-btn color="primary" variant="text" :loading="editSaving" @click="saveMetadata">保存</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <v-dialog v-model="isOpenMergeDialog" max-width="600">
            <v-card>
                <v-card-title>シリーズのマージ</v-card-title>
                <v-card-text>
                    <v-select
                        v-model="mergeFromId"
                        :items="items.map(x => ({ title: x.title, value: x.id }))"
                        item-title="title"
                        label="統合元シリーズ (このシリーズは消えます)"
                    ></v-select>
                    <v-text-field v-model="mergeToKeyword" label="統合先シリーズを検索" @keyup.enter="searchMergeTarget"></v-text-field>
                    <v-select v-model="mergeToId" :items="mergeToItems.map(x => ({ title: x.title, value: x.id }))" item-title="title" label="統合先シリーズ"></v-select>
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
import * as apid from '../../../api';
import ISeriesApiModel, { SeriesListItem } from '@/model/api/series/ISeriesApiModel';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Vue, toNative } from 'vue-facing-decorator';
@Component({ components: { TitleBar } })
class SeriesView extends Vue {
    // 表示形式の選択を保存する localStorage キー
    private static readonly VIEW_MODE_KEY = 'series-view-mode';

    keyword = '';
    items: SeriesListItem[] = [];
    total = 0;
    offset = 0;
    limit = 30;
    loading = false;

    sort: apid.SeriesSortKey = 'updatedAt';
    order: 'asc' | 'desc' = 'desc';
    season: string | null = null;
    status: 'onair' | 'finished' | null = null;
    hasMissing = false;
    viewMode: 'grid' | 'list' | 'compact' = 'grid';
    seasons: apid.SeriesSeasonItem[] = [];

    readonly sortItems = [
        { title: '更新が新しい順', value: 'updatedAt' },
        { title: 'あいうえお順', value: 'title' },
        { title: '放送開始日', value: 'firstAiredAt' },
        { title: '最終放送日', value: 'lastAiredAt' },
        { title: '録画件数', value: 'recordedCount' },
        { title: '保存容量', value: 'totalFileSize' },
    ];
    readonly statusItems = [
        { title: '放送中', value: 'onair' },
        { title: '完結', value: 'finished' },
    ];

    private static readonly SEASON_LABEL: Record<string, string> = {
        WINTER: '冬',
        SPRING: '春',
        SUMMER: '夏',
        AUTUMN: '秋',
    };

    /**
     * クール絞り込みの選択肢 ("2025年春 (12)" 形式)。
     * シリーズにはアニメ以外 (ドラマ・バラエティ等) も含まれるためジャンル名は付けない
     */
    get seasonItems(): Array<{ title: string; value: string }> {
        return this.seasons.map(x => ({
            title: `${x.seasonYear}年${SeriesView.SEASON_LABEL[x.seasonName] ?? x.seasonName} (${x.count})`,
            value: `${x.seasonYear}:${x.seasonName}`,
        }));
    }

    /**
     * カード/リストに出すクール表記
     */
    seasonText(item: SeriesListItem): string {
        if (typeof item.seasonYear !== 'number' || item.seasonYear === null) return '-';
        const label = SeriesView.SEASON_LABEL[item.seasonName ?? ''] ?? '';
        return `${item.seasonYear}年${label}`;
    }

    /**
     * 視聴済みの割合 (進捗バー用)
     */
    watchedPercent(item: SeriesListItem): number {
        if (item.recordedCount === 0) return 0;
        return Math.round(((item.recordedCount - item.unwatchedCount) / item.recordedCount) * 100);
    }

    /**
     * バイト数を人が読める表記にする
     */
    fileSizeText(size: number): string {
        if (!size || size <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const index = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
        return `${(size / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
    }

    toggleOrder(): void {
        this.order = this.order === 'asc' ? 'desc' : 'asc';
        void this.reload();
    }

    saveViewMode(): void {
        try {
            window.localStorage.setItem(SeriesView.VIEW_MODE_KEY, this.viewMode);
        } catch (err) {
            // プライベートモード等で保存できなくても表示自体は動くので無視する
            console.error(err);
        }
    }

    /**
     * 絞り込み・並べ替えを変えたときは 1 ページ目へ戻す
     */
    async reload(): Promise<void> {
        this.offset = 0;
        await this.load();
    }

    isOpenMergeDialog = false;
    isOpenConfirmMergeDialog = false;
    mergeFromId: number | null = null;
    mergeToKeyword = '';
    mergeToId: number | null = null;
    mergeToItems: SeriesListItem[] = [];
    merging = false;
    refreshing = false;

    isOpenEditDialog = false;
    editSeriesId: number | null = null;
    editTitle = '';
    editSeasonYear: number | null = null;
    editSeasonName: string | null = null;
    editSeasonSource: string | null = null;
    editTitleKana: string | null = null;
    editTotalEpisodes: number | null = null;
    editSaving = false;

    readonly seasonNameItems = [
        { title: '冬 (1-3月)', value: 'WINTER' },
        { title: '春 (4-6月)', value: 'SPRING' },
        { title: '夏 (7-9月)', value: 'SUMMER' },
        { title: '秋 (10-12月)', value: 'AUTUMN' },
    ];

    private api = container.get<ISeriesApiModel>('ISeriesApiModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    mounted() {
        const saved = window.localStorage.getItem(SeriesView.VIEW_MODE_KEY);
        if (saved === 'grid' || saved === 'list' || saved === 'compact') this.viewMode = saved;
        void this.loadSeasons();
        void this.load();
    }

    async loadSeasons(): Promise<void> {
        try {
            this.seasons = await this.api.listSeasons();
        } catch (err) {
            // クール情報が無くても一覧自体は表示できるので握りつぶす
            console.error(err);
        }
    }

    async load() {
        this.loading = true;
        try {
            const [seasonYear, seasonName] = (this.season ?? '').split(':');
            const x = await this.api.list({
                keyword: this.keyword,
                offset: this.offset,
                limit: this.limit,
                sort: this.sort,
                order: this.order,
                seasonYear: seasonYear ? Number(seasonYear) : undefined,
                seasonName: seasonName || undefined,
                status: this.status ?? undefined,
                hasMissing: this.hasMissing,
            });
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

    /**
     * 既存シリーズのクール・読み仮名・総話数を作品辞書から埋め直す
     */
    async refreshMetadata(): Promise<void> {
        this.refreshing = true;
        try {
            const result = await this.api.refreshMetadata();
            // LLM フォールバックを使った場合は、辞書で引けなかった分を何件救えたかも知らせる
            const llm = result.llmAnalyzed > 0 ? ` (LLM 解析 ${result.llmAnalyzed} 件中 ${result.llmResolved} 件確定)` : '';
            this.snackbarState.open({
                color: 'success',
                text: `${result.scanned} 件中 ${result.updated} 件を更新しました${llm}`,
            });
            await this.loadSeasons();
            await this.load();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'メタデータの再取得に失敗しました' });
        } finally {
            this.refreshing = false;
        }
    }

    /**
     * クール・読み仮名・総話数の手動編集ダイアログを開く
     */
    openEditDialog(item: SeriesListItem): void {
        this.editSeriesId = item.id;
        this.editTitle = item.title;
        this.editSeasonYear = item.seasonYear ?? null;
        this.editSeasonName = item.seasonName ?? null;
        this.editSeasonSource = item.seasonSource ?? null;
        this.editTitleKana = item.titleKana ?? null;
        this.editTotalEpisodes = item.totalEpisodes ?? null;
        this.isOpenEditDialog = true;
    }

    async saveMetadata(): Promise<void> {
        if (this.editSeriesId === null) return;
        // 年と季節はセットでのみ意味を持つため、片方だけの指定は保存させない
        const hasYear = typeof this.editSeasonYear === 'number' && this.editSeasonYear !== null;
        const hasName = typeof this.editSeasonName === 'string' && this.editSeasonName !== null;
        if (hasYear !== hasName) {
            this.snackbarState.open({ color: 'error', text: '年と季節は両方指定してください' });
            return;
        }
        this.editSaving = true;
        try {
            await this.api.updateSeriesMetadata(this.editSeriesId, {
                seasonYear: hasYear ? this.editSeasonYear : null,
                seasonName: hasName ? this.editSeasonName : null,
                titleKana: this.editTitleKana === '' ? null : this.editTitleKana,
                totalEpisodes:
                    typeof this.editTotalEpisodes === 'number' && this.editTotalEpisodes !== null
                        ? this.editTotalEpisodes
                        : null,
            });
            this.snackbarState.open({ color: 'success', text: 'シリーズ情報を更新しました' });
            this.isOpenEditDialog = false;
            await this.loadSeasons();
            await this.load();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'シリーズ情報の更新に失敗しました' });
        } finally {
            this.editSaving = false;
        }
    }

    openMergeDialog(): void {
        this.mergeFromId = null;
        this.mergeToId = null;
        this.mergeToKeyword = '';
        this.mergeToItems = this.items;
        this.isOpenMergeDialog = true;
    }

    async searchMergeTarget(): Promise<void> {
        const x = await this.api.list({ keyword: this.mergeToKeyword, offset: 0, limit: 100 });
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
