<template>
    <v-main>
        <TitleBar title="シリーズ">
            <template v-slot:menu>
                <v-btn icon variant="text" size="small" :to="'/series/pending'" title="未確定キュー">
                    <v-icon>mdi-help-box-outline</v-icon>
                </v-btn>
                <v-btn
                    icon
                    variant="text"
                    size="small"
                    :color="selectionMode === true ? 'primary' : undefined"
                    @click="toggleSelectionMode"
                    title="選択モード (チェックしたシリーズをまとめてマージ)"
                >
                    <v-icon>mdi-checkbox-multiple-marked-outline</v-icon>
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
                <v-select
                    v-model="origin"
                    :items="originItems"
                    item-title="title"
                    label="出所"
                    density="compact"
                    hide-details
                    clearable
                    style="max-width: 190px"
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

            <!-- 選択モードのツールバー。チェックしたシリーズをまとめて 1 つへ統合する -->
            <v-toolbar v-if="selectionMode === true" density="compact" color="primary" class="rounded mb-2">
                <v-btn icon variant="text" size="small" @click="toggleSelectionMode" title="選択モードを終了">
                    <v-icon>mdi-close</v-icon>
                </v-btn>
                <v-toolbar-title class="text-body-2">{{ selectedIds.length }} 件選択中</v-toolbar-title>
                <v-btn variant="text" size="small" @click="selectAllInPage">表示中をすべて選択</v-btn>
                <v-btn variant="text" size="small" :disabled="selectedIds.length === 0" @click="clearSelection">選択解除</v-btn>
                <v-btn variant="text" size="small" prepend-icon="mdi-call-merge" :disabled="selectedIds.length === 0" @click="openMergeDialog">
                    マージ
                </v-btn>
            </v-toolbar>

            <!-- グリッド表示 -->
            <v-row v-if="viewMode === 'grid'">
                <v-col v-for="item in items" :key="item.id" cols="12" sm="6" md="4">
                    <v-card
                        :to="selectionMode === true ? undefined : `/series/${item.id}`"
                        height="100%"
                        class="d-flex flex-column"
                        :color="isSelected(item.id) ? 'blue-lighten-5' : undefined"
                        @click="selectionMode === true ? toggleSelect(item.id) : undefined"
                    >
                        <div v-if="selectionMode === true" class="series-select-overlay">
                            <v-checkbox-btn :model-value="isSelected(item.id)" @click.stop="toggleSelect(item.id)"></v-checkbox-btn>
                        </div>
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
                            <v-chip size="x-small" :color="originColor(item)" variant="flat" class="ml-1" :title="originTitle(item)">
                                {{ originText(item) }}
                            </v-chip>
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
                    <v-list-item
                        v-for="item in items"
                        :key="item.id"
                        :to="selectionMode === true ? undefined : `/series/${item.id}`"
                        :active="isSelected(item.id)"
                        class="px-2"
                        @click="selectionMode === true ? toggleSelect(item.id) : undefined"
                    >
                        <template v-slot:prepend>
                            <v-checkbox-btn
                                v-if="selectionMode === true"
                                :model-value="isSelected(item.id)"
                                class="flex-grow-0 mr-1"
                                @click.stop="toggleSelect(item.id)"
                            ></v-checkbox-btn>
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
                            <v-chip size="x-small" :color="originColor(item)" variant="flat" :title="originTitle(item)">{{ originText(item) }}</v-chip>
                        </div>
                    </v-list-item>
                </v-list>
            </v-card>

            <!-- コンパクト表示: 画像なしの高密度一覧 -->
            <v-table v-else density="compact">
                <thead>
                    <tr>
                        <th v-if="selectionMode === true" style="width: 48px"></th>
                        <th>タイトル</th>
                        <th v-if="isMobile === false" style="width: 90px">出所</th>
                        <th v-if="isMobile === false" style="width: 110px">クール</th>
                        <th style="width: 90px">録画</th>
                        <th v-if="isMobile === false" style="width: 90px">未視聴</th>
                        <th v-if="isMobile === false" style="width: 90px">容量</th>
                        <th style="width: 120px">状態</th>
                        <th style="width: 48px"></th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="item in items"
                        :key="item.id"
                        style="cursor: pointer"
                        :class="{ 'bg-blue-lighten-5': isSelected(item.id) }"
                        @click="selectionMode === true ? toggleSelect(item.id) : $router.push(`/series/${item.id}`)"
                    >
                        <td v-if="selectionMode === true" @click.stop>
                            <v-checkbox-btn :model-value="isSelected(item.id)" @click="toggleSelect(item.id)"></v-checkbox-btn>
                        </td>
                        <td class="text-truncate" style="max-width: 1px">
                            {{ item.title }}
                            <div v-if="isMobile === true" class="text-caption text-medium-emphasis text-truncate">
                                <v-chip size="x-small" :color="originColor(item)" variant="flat" :title="originTitle(item)">{{ originText(item) }}</v-chip>
                                {{ seasonText(item) }}<span v-if="item.seasonSource === 'estimated'">(推定)</span>
                                / 未視聴 {{ item.unwatchedCount }} / {{ fileSizeText(item.totalFileSize) }}
                            </div>
                        </td>
                        <td v-if="isMobile === false">
                            <v-chip size="x-small" :color="originColor(item)" variant="flat" :title="originTitle(item)">{{ originText(item) }}</v-chip>
                        </td>
                        <td v-if="isMobile === false">
                            {{ seasonText(item) }}
                            <span v-if="item.seasonSource === 'estimated'" class="text-caption text-grey">(推定)</span>
                        </td>
                        <td>{{ item.recordedCount }}</td>
                        <td v-if="isMobile === false">{{ item.unwatchedCount }}</td>
                        <td v-if="isMobile === false">{{ fileSizeText(item.totalFileSize) }}</td>
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
            <div class="mt-4">
                <div class="text-center text-caption text-grey mb-1" v-if="total > 0">
                    {{ offset + 1 }}–{{ Math.min(offset + limit, total) }} / {{ total }}
                </div>
                <Pagination :total="total" :pageSize="limit"></Pagination>
            </div>
        </v-container>

        <v-dialog v-model="isOpenEditDialog" max-width="520">
            <v-card>
                <v-card-title>シリーズ情報の編集</v-card-title>
                <v-card-subtitle>{{ editOriginalTitle }}</v-card-subtitle>
                <v-card-text>
                    <v-alert v-if="editSeasonSource === 'estimated'" type="info" density="compact" class="mb-3">
                        現在のクールは<b>最古の録画日時からの推測値</b>です。保存すると手動設定として固定され、以降の自動補完で上書きされなくなります。
                    </v-alert>
                    <v-text-field
                        v-model="editTitle"
                        label="シリーズ名 (表示名)"
                        density="compact"
                        :disabled="editResetTitle"
                        persistent-hint
                        hint="変更すると手動設定になり、メタデータ再取得で作品辞書の名前に戻されなくなります (自動判定に使う正規化タイトルは変わりません)"
                    ></v-text-field>
                    <v-alert v-if="editResetTitle === true" type="info" density="compact" class="my-3">
                        保存すると手動設定を解除します。次回のメタデータ再取得で<b>作品辞書の正式タイトル</b>へ戻ります。
                    </v-alert>
                    <div v-else-if="editTitleSource === 'manual'" class="d-flex align-center my-3">
                        <span class="text-caption">シリーズ名は手動設定です (自動同期の対象外)</span>
                        <v-spacer></v-spacer>
                        <v-btn size="small" variant="text" color="primary" @click="resetTitleToDictionary">辞書名に戻す</v-btn>
                    </div>
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

        <v-dialog v-model="isOpenMergeDialog" max-width="720">
            <v-card>
                <v-card-title>シリーズのマージ</v-card-title>
                <v-card-subtitle>選択した {{ selectedIds.length }} 件を 1 つのシリーズへ統合します</v-card-subtitle>
                <v-card-text>
                    <!-- 統合先はしょぼいカレンダー / Annict などの辞書起点シリーズを既定にする (自動判定がそこへ寄るため) -->
                    <v-select
                        v-model="mergeToId"
                        :items="mergeTargetItems"
                        item-title="title"
                        item-value="value"
                        label="統合先シリーズ (このシリーズが残ります)"
                        :loading="loadingMergeCandidates"
                        density="compact"
                    ></v-select>
                    <v-alert v-if="mergeToOrigin === 'local'" type="warning" density="compact" class="mb-3">
                        統合先が辞書起点のシリーズではありません。しょぼいカレンダー / Annict / Wikidata に紐づくシリーズを統合先にすると、以降の自動判定もそのシリーズへ寄ります。
                    </v-alert>
                    <v-text-field
                        v-model="mergeToKeyword"
                        label="統合先を検索して候補に追加"
                        density="compact"
                        append-inner-icon="mdi-magnify"
                        hide-details
                        class="mb-3"
                        @keyup.enter="searchMergeTarget"
                        @click:append-inner="searchMergeTarget"
                    ></v-text-field>

                    <div class="text-caption text-grey">統合されて削除されるシリーズ ({{ mergeSources.length }} 件)</div>
                    <v-list density="compact" class="py-0">
                        <v-list-item v-for="s in mergeSources" :key="s.id">
                            <v-list-item-title class="text-body-2">{{ s.title }}</v-list-item-title>
                            <v-list-item-subtitle>録画 {{ s.recordedCount }} 件</v-list-item-subtitle>
                            <template v-slot:append>
                                <v-chip size="x-small" :color="originColor(s)" variant="flat">{{ originText(s) }}</v-chip>
                            </template>
                        </v-list-item>
                    </v-list>
                    <v-alert v-if="mergeSources.length === 0" type="warning" density="compact">
                        統合元がありません (選択したシリーズが統合先と同じです)
                    </v-alert>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="isOpenMergeDialog = false">キャンセル</v-btn>
                    <v-btn
                        color="primary"
                        variant="text"
                        :disabled="mergeToId === null || mergeSources.length === 0"
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
                    {{ mergeSources.length }} 件のシリーズを「{{ mergeToTitle }}」へ統合します。統合元に紐づく録画はすべて統合先へ移動し、統合元のシリーズは削除されます。この操作は取り消せません。よろしいですか？
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
import Pagination from '@/components/pagination/Pagination.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import * as apid from '../../../api';
import ISeriesApiModel, { SeriesListItem } from '@/model/api/series/ISeriesApiModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import Util from '@/util/Util';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';
import type { LocationQueryRaw } from 'vue-router';

/**
 * マージダイアログの統合先候補
 */
interface MergeTargetOption {
    id: number;
    title: string;
    origin: apid.SeriesOrigin;
    recordedCount: number;
}

@Component({ components: { TitleBar, Pagination } })
class SeriesView extends Vue {
    // スマホ・タブレットではコンパクト表示の列を間引きし、タイトルの下にまとめて表示する
    get isMobile(): boolean {
        return this.$vuetify.display.smAndDown;
    }

    // 表示形式の選択を保存する localStorage キー
    private static readonly VIEW_MODE_KEY = 'series-view-mode';
    // マージ候補を問い合わせる選択シリーズの上限 (選択が多いときに API を叩きすぎないため)
    private static readonly MERGE_LOOKUP_LIMIT = 5;
    // URL query に載せない既定の並べ替え条件
    private static readonly DEFAULT_SORT: apid.SeriesSortKey = 'updatedAt';
    private static readonly DEFAULT_ORDER: 'asc' | 'desc' = 'desc';

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
    origin: apid.SeriesOrigin | null = null;
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
    // 出所での絞り込み。誤生成されたシリーズは辞書で引けなかった 'local' 側に偏るため、掃除のときはこれで絞る
    readonly originItems = [
        { title: '辞書起点', value: 'dictionary' },
        { title: 'ローカル生成', value: 'local' },
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
     * 絞り込み・並べ替えを変えたときは 1 ページ目へ戻す。
     * 検索条件は URL query に載せるため、実際の再取得は $route の変化を受けて行う
     * (これにより戻る操作で検索結果とページ位置が復元される)
     */
    async reload(): Promise<void> {
        await this.pushQuery(1);
    }

    /**
     * 現在の検索条件を URL query に反映する
     * @param page: 遷移先のページ番号
     */
    private async pushQuery(page: number): Promise<void> {
        const query: LocationQueryRaw = {};
        if (this.keyword !== null && this.keyword !== '') query.keyword = this.keyword;
        if (this.sort !== SeriesView.DEFAULT_SORT) query.sort = this.sort;
        if (this.order !== SeriesView.DEFAULT_ORDER) query.order = this.order;
        if (this.season !== null && this.season !== '') query.season = this.season;
        if (this.status !== null) query.status = this.status;
        if (this.origin !== null) query.origin = this.origin;
        if (this.hasMissing === true) query.hasMissing = '1';
        if (page > 1) query.page = page.toString(10);

        // query に変化が無いと router が動かず再取得もされないため、その場合は直接取得する
        const current = { ...this.$route.query };
        delete current.timestamp;
        const isSame =
            Object.keys(current).length === Object.keys(query).length &&
            Object.keys(current).every(key => current[key] === query[key]);
        if (isSame === true) {
            await this.load();
            return;
        }

        await Util.move(this.$router, { path: '/series', query: query });
    }

    /**
     * URL query から検索条件・ページ位置を復元する
     */
    private applyQuery(): void {
        const query = this.$route.query;
        const sort = Util.getRouteString(query.sort);
        const order = Util.getRouteString(query.order);
        const status = Util.getRouteString(query.status);
        const origin = Util.getRouteString(query.origin);

        this.keyword = Util.getRouteString(query.keyword) ?? '';
        this.sort = (this.sortItems.some(x => x.value === sort) ? sort : SeriesView.DEFAULT_SORT) as apid.SeriesSortKey;
        this.order = order === 'asc' || order === 'desc' ? order : SeriesView.DEFAULT_ORDER;
        this.season = Util.getRouteString(query.season) ?? null;
        this.status = status === 'onair' || status === 'finished' ? status : null;
        this.origin = origin === 'dictionary' || origin === 'local' ? origin : null;
        this.hasMissing = Util.getRouteString(query.hasMissing) === '1';
        this.offset = (Util.getPageNum(this.$route) - 1) * this.limit;
    }

    selectionMode = false;
    selectedIds: number[] = [];

    isOpenMergeDialog = false;
    isOpenConfirmMergeDialog = false;
    mergeToKeyword = '';
    mergeToId: number | null = null;
    // 統合先の選択肢。選択したシリーズ + 前方一致候補 + キーワード検索結果をまとめたもの
    mergeCandidates: MergeTargetOption[] = [];
    loadingMergeCandidates = false;
    merging = false;
    refreshing = false;

    isOpenEditDialog = false;
    editSeriesId: number | null = null;
    editTitle = '';
    // 編集前のシリーズ名 (ダイアログの見出し用)
    editOriginalTitle = '';
    editTitleSource: string | null = null;
    // 「辞書名に戻す」を押したか (保存時に手動設定を解除する)
    editResetTitle = false;
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
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');

    mounted() {
        const saved = window.localStorage.getItem(SeriesView.VIEW_MODE_KEY);
        if (saved === 'grid' || saved === 'list' || saved === 'compact') this.viewMode = saved;
        void this.loadSeasons();
    }

    /**
     * URL query の変化 (検索条件変更・ページ移動・ブラウザバック) で一覧を取り直す
     */
    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.applyQuery();
        this.$nextTick(async () => {
            await this.load();
            // スクロール位置復元のためデータ取得完了を通知する
            await this.scrollState.emitDoneGetData();
        });
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
                origin: this.origin ?? undefined,
                hasMissing: this.hasMissing,
            });
            this.items = x.items;
            this.total = x.total;
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'シリーズ一覧の取得に失敗しました' });
        } finally {
            this.loading = false;
        }
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
            // 作品コメントは 1 作品ごとにしょぼいカレンダーへ問い合わせるため 1 回で取り切れない。
            // 残りが何件あるかを出し、もう一度実行すれば進むことが分かるようにする
            const comment =
                result.commentFetched > 0 || result.commentPending > 0
                    ? ` / コメント ${result.commentFilled} 件取得` +
                      (result.commentPending > 0 ? `、残り ${result.commentPending} 件` : '')
                    : '';
            // 外部辞書の正式タイトルへ合わせた件数 (シリーズ名が変わるため明示する)
            const title = result.titleSynced > 0 ? ` / シリーズ名 ${result.titleSynced} 件を辞書名へ同期` : '';
            this.snackbarState.open({
                color: 'success',
                text: `${result.scanned} 件中 ${result.updated} 件を更新しました${llm}${title}${comment}`,
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
        this.editOriginalTitle = item.title;
        this.editTitleSource = item.titleSource ?? null;
        this.editResetTitle = false;
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
        const title = this.editTitle.trim();
        if (this.editResetTitle === false && title === '') {
            this.snackbarState.open({ color: 'error', text: 'シリーズ名を入力してください' });
            return;
        }
        this.editSaving = true;
        try {
            await this.api.updateSeriesMetadata(this.editSeriesId, {
                // 「辞書名に戻す」を押した場合は null を送って手動設定を解除する。
                // 変更していない場合は送らない (出所を manual にしてしまわないため)
                title: this.editResetTitle === true ? null : title === this.editOriginalTitle ? undefined : title,
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

    /**
     * シリーズ名の手動設定を解除する (保存時に反映され、次回のメタデータ再取得で辞書名へ戻る)
     */
    resetTitleToDictionary(): void {
        this.editResetTitle = true;
        this.editTitleSource = null;
    }

    /**
     * シリーズの出所 (辞書起点 / ローカル生成) の表示テキスト
     */
    originText(item: { origin?: apid.SeriesOrigin }): string {
        return item.origin === 'dictionary' ? '辞書' : 'ローカル';
    }
    originColor(item: { origin?: apid.SeriesOrigin }): string {
        return item.origin === 'dictionary' ? 'teal' : 'grey';
    }
    originTitle(item: { origin?: apid.SeriesOrigin }): string {
        return item.origin === 'dictionary'
            ? 'しょぼいカレンダー / Annict / Wikidata の作品辞書に紐づくシリーズ'
            : '録画タイトルから作られたシリーズ (誤生成の可能性あり)';
    }

    toggleSelectionMode(): void {
        this.selectionMode = !this.selectionMode;
        if (this.selectionMode === false) this.selectedIds = [];
    }
    isSelected(id: number): boolean {
        return this.selectedIds.includes(id);
    }
    toggleSelect(id: number): void {
        this.selectedIds = this.isSelected(id) ? this.selectedIds.filter(x => x !== id) : [...this.selectedIds, id];
    }
    selectAllInPage(): void {
        this.selectedIds = [...new Set([...this.selectedIds, ...this.items.map(x => x.id)])];
    }
    clearSelection(): void {
        this.selectedIds = [];
    }

    get mergeTargetItems(): Array<{ title: string; value: number }> {
        return this.mergeCandidates.map(x => ({
            title: `${x.title} [${this.originText(x)}] (録画 ${x.recordedCount} 件)`,
            value: x.id,
        }));
    }
    /**
     * 統合されて消える側 (選択したシリーズから統合先を除いたもの)
     */
    get mergeSources(): MergeTargetOption[] {
        return this.mergeCandidates.filter(x => x.id !== this.mergeToId && this.selectedIds.includes(x.id));
    }
    get mergeToOrigin(): apid.SeriesOrigin | null {
        return this.mergeCandidates.find(x => x.id === this.mergeToId)?.origin ?? null;
    }
    get mergeToTitle(): string {
        return this.mergeCandidates.find(x => x.id === this.mergeToId)?.title ?? '';
    }

    /**
     * マージダイアログを開き、統合先の候補を組み立てる。
     * 候補は「選択したシリーズ」＋「選択したシリーズと正規化タイトルが前方一致するシリーズ」で、
     * 既定の統合先には辞書起点 (しょぼいカレンダー / Annict / Wikidata) のシリーズを優先して選ぶ
     */
    async openMergeDialog(): Promise<void> {
        if (this.selectedIds.length === 0) return;
        this.mergeToKeyword = '';
        this.mergeToId = null;
        this.mergeCandidates = this.items
            .filter(x => this.selectedIds.includes(x.id))
            .map(x => ({ id: x.id, title: x.title, origin: x.origin, recordedCount: x.recordedCount }));
        this.isOpenMergeDialog = true;

        this.loadingMergeCandidates = true;
        try {
            // 選択が多いときに問い合わせが増えすぎないよう、候補検索は先頭数件のシリーズに限る
            const lookupIds = this.selectedIds.slice(0, SeriesView.MERGE_LOOKUP_LIMIT);
            const results = await Promise.all(
                lookupIds.map(id => this.api.getMergeCandidates(id).catch(() => null)),
            );
            for (const result of results) {
                if (result === null) continue;
                for (const c of result.candidates) {
                    this.addMergeCandidate({
                        id: c.seriesId,
                        title: c.title,
                        origin: c.origin,
                        recordedCount: c.recordedCount,
                    });
                }
            }
        } catch (err) {
            console.error(err);
        } finally {
            this.loadingMergeCandidates = false;
            this.mergeToId = this.pickDefaultMergeTarget();
        }
    }

    /**
     * 統合先の既定値。辞書起点のシリーズを優先し、同条件なら録画件数が多いものを選ぶ
     */
    private pickDefaultMergeTarget(): number | null {
        const score = (x: MergeTargetOption): number => (x.origin === 'dictionary' ? 1 : 0);
        const sorted = [...this.mergeCandidates].sort((a, b) => {
            if (score(a) !== score(b)) return score(b) - score(a);
            return b.recordedCount - a.recordedCount;
        });
        return sorted[0]?.id ?? null;
    }

    private addMergeCandidate(value: MergeTargetOption): void {
        if (this.mergeCandidates.some(x => x.id === value.id)) return;
        this.mergeCandidates.push(value);
    }

    /**
     * キーワード検索した結果を統合先の候補に足す (前方一致で出てこないシリーズへ寄せたいとき用)
     */
    async searchMergeTarget(): Promise<void> {
        if (this.mergeToKeyword.trim() === '') return;
        this.loadingMergeCandidates = true;
        try {
            const x = await this.api.list({ keyword: this.mergeToKeyword, offset: 0, limit: 50 });
            for (const item of x.items) {
                this.addMergeCandidate({
                    id: item.id,
                    title: item.title,
                    origin: item.origin,
                    recordedCount: item.recordedCount,
                });
            }
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'シリーズの検索に失敗しました' });
        } finally {
            this.loadingMergeCandidates = false;
        }
    }

    async executeMerge(): Promise<void> {
        const sources = this.mergeSources.map(x => x.id);
        if (this.mergeToId === null || sources.length === 0) return;
        this.merging = true;
        try {
            const result = await this.api.merge(sources, this.mergeToId);
            this.snackbarState.open({
                color: 'success',
                text: `${result.mergedSeriesCount} 件のシリーズを統合しました (録画 ${result.movedLinkCount} 件を移動)`,
            });
            this.isOpenConfirmMergeDialog = false;
            this.isOpenMergeDialog = false;
            this.selectedIds = [];
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

<style lang="sass" scoped>
// グリッド表示のチェックボックスはサムネイルに重ねる
.series-select-overlay
    position: absolute
    top: 4px
    left: 4px
    z-index: 2
    border-radius: 50%
    background: rgba(255, 255, 255, 0.85)
</style>
