<template>
    <v-main>
        <TitleBar :title="detail?.title || 'シリーズ詳細'">
            <template v-slot:menu>
                <v-btn
                    v-if="isBulkMode === false && isSplitMode === false"
                    icon
                    variant="text"
                    size="small"
                    @click="startBulkEdit"
                    title="話数・放送種別の一括編集"
                >
                    <v-icon>mdi-playlist-edit</v-icon>
                </v-btn>
                <v-btn v-if="isBulkMode === true" icon variant="text" size="small" @click="cancelBulkEdit" title="一括編集をやめる">
                    <v-icon>mdi-close</v-icon>
                </v-btn>
                <v-btn v-if="isSplitMode === false && isBulkMode === false" icon variant="text" size="small" @click="isSplitMode = true" title="分割">
                    <v-icon>mdi-call-split</v-icon>
                </v-btn>
                <v-btn v-if="isSplitMode === true" icon variant="text" size="small" @click="cancelSplit" title="分割をやめる">
                    <v-icon>mdi-close</v-icon>
                </v-btn>
            </template>
        </TitleBar>
        <v-container v-if="detail">
            <div class="d-flex align-center mb-3">
                <v-chip v-if="detail.externalIds.annictId" color="green">Annict: {{ detail.externalIds.annictId }}</v-chip>
                <v-btn class="ml-2" variant="outlined" :loading="annictSyncing" @click="syncAnnict">Annict同期</v-btn>
            </div>
            <v-alert v-if="annictMessage" type="success" class="mb-3">{{ annictMessage }}</v-alert>
            <v-alert v-if="detail.continuity.missingEpisodes.length" type="warning" class="mb-3">欠番: {{ missingEpisodeText }}</v-alert>
            <v-alert v-if="detail.continuity.duplicateEpisodes.length" type="info" class="mb-3">複数録画・再放送: {{ duplicateEpisodeText }}</v-alert>

            <v-card v-if="futureProposals.length > 0" class="mb-3" variant="outlined">
                <v-card-title class="text-subtitle-1">今後の放送予定・欠番補完</v-card-title>
                <v-list>
                    <v-list-item v-for="p in futureProposals" :key="`${p.seasonNumber}-${p.episodeNumber}`">
                        <v-list-item-title>S{{ p.seasonNumber }} 第{{ p.episodeNumber }}話</v-list-item-title>
                        <v-list-item-subtitle v-for="c in p.candidates" :key="c.programId">
                            {{ c.name }} ({{ formatDate(c.startAt) }})
                            <v-btn size="x-small" variant="text" color="primary" :loading="reservingKey === `${p.seasonNumber}-${p.episodeNumber}-${c.programId}`" @click="reserveProposal(p, c)"
                                >予約</v-btn
                            >
                        </v-list-item-subtitle>
                    </v-list-item>
                </v-list>
            </v-card>

            <v-select v-model="channelId" :items="channelItems" item-title="title" item-value="value" label="放送局で絞り込み" @update:model-value="load"></v-select>

            <!-- 話数・放送種別の一括編集 -->
            <template v-if="isBulkMode === true">
                <v-card variant="outlined" class="mb-3">
                    <v-card-text class="pb-2">
                        <div class="d-flex align-center ga-2 flex-wrap mb-2">
                            <v-btn size="small" variant="text" @click="selectAllRecorded">すべて選択</v-btn>
                            <v-btn size="small" variant="text" :disabled="selectedRecordedIds.length === 0" @click="selectedRecordedIds = []">選択解除</v-btn>
                            <span class="text-caption text-grey">{{ selectedRecordedIds.length }} 件選択中</span>
                        </div>
                        <div class="d-flex align-center ga-2 flex-wrap">
                            <v-text-field
                                v-model.number="sequenceStart"
                                type="number"
                                label="開始話数"
                                density="compact"
                                hide-details
                                style="max-width: 120px"
                            ></v-text-field>
                            <v-btn size="small" variant="tonal" :disabled="selectedRecordedIds.length === 0" @click="applySequence">
                                選択に連番を振る (放送日時順)
                            </v-btn>
                            <v-divider vertical></v-divider>
                            <v-select
                                v-model="bulkAirType"
                                :items="airTypeItems"
                                item-title="title"
                                item-value="value"
                                label="放送種別"
                                density="compact"
                                hide-details
                                style="max-width: 160px"
                            ></v-select>
                            <v-btn size="small" variant="tonal" :disabled="selectedRecordedIds.length === 0" @click="applyAirType">選択に適用</v-btn>
                        </div>
                    </v-card-text>
                </v-card>

                <v-table density="compact">
                    <thead>
                        <tr>
                            <th style="width: 48px"></th>
                            <th style="width: 110px">話数</th>
                            <th>タイトル</th>
                            <th style="width: 200px">放送局・放送日時</th>
                            <th style="width: 150px">放送種別</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="item in detail.recorded" :key="item.recordedId">
                            <td>
                                <v-checkbox-btn v-model="selectedRecordedIds" :value="item.recordedId"></v-checkbox-btn>
                            </td>
                            <td>
                                <v-text-field
                                    v-model.number="edits[item.recordedId].episodeNumber"
                                    type="number"
                                    density="compact"
                                    variant="outlined"
                                    hide-details
                                    clearable
                                    :class="{ 'text-primary': isEdited(item) }"
                                ></v-text-field>
                            </td>
                            <td class="text-truncate" style="max-width: 1px">{{ item.episodeTitle || item.recordedTitle }}</td>
                            <td class="text-caption">{{ item.channelName || item.channelId }}<br />{{ formatDate(item.startAt) }}</td>
                            <td>
                                <v-select
                                    v-model="edits[item.recordedId].airType"
                                    :items="airTypeItems"
                                    item-title="title"
                                    item-value="value"
                                    density="compact"
                                    variant="outlined"
                                    hide-details
                                ></v-select>
                            </td>
                        </tr>
                    </tbody>
                </v-table>
                <div class="d-flex align-center ga-2 mt-3">
                    <v-btn color="primary" :loading="bulkSaving" :disabled="changedItems.length === 0" @click="saveBulk">
                        変更を保存 ({{ changedItems.length }} 件)
                    </v-btn>
                    <v-btn variant="text" @click="cancelBulkEdit">キャンセル</v-btn>
                </div>
            </template>

            <v-list v-else lines="three">
                <v-list-item v-for="item in detail.recorded" :key="item.recordedId" :to="isSplitMode === true ? undefined : `/recorded/detail/${item.recordedId}`">
                    <template #prepend>
                        <v-checkbox v-if="isSplitMode === true" v-model="selectedRecordedIds" :value="item.recordedId" hide-details density="compact"></v-checkbox>
                        <v-avatar v-else color="primary">{{ item.episodeNumber ?? '-' }}</v-avatar>
                    </template>
                    <v-list-item-title>{{ episodeTitle(item) }}</v-list-item-title>
                    <v-list-item-subtitle>{{ item.channelName || item.channelId }} · {{ formatDate(item.startAt) }}</v-list-item-subtitle>
                    <template #append>
                        <v-chip v-if="item.airType === 'rerun'" color="orange" size="small">再放送</v-chip>
                        <v-chip v-else-if="item.airType === 'delayed'" color="purple" size="small">遅れ放送</v-chip>
                        <v-chip v-else-if="isDuplicate(item.recordedId)" color="blue" size="small">複数録画</v-chip>
                    </template>
                </v-list-item>
            </v-list>
            <v-alert v-if="detail.recorded.length === 0" type="info">この放送局の録画はありません</v-alert>

            <v-card v-if="isSplitMode === true" class="mt-3" variant="outlined">
                <v-card-text>
                    <v-text-field v-model="splitNewTitle" label="新しいシリーズ名"></v-text-field>
                    <v-btn color="primary" :loading="splitting" :disabled="selectedRecordedIds.length === 0 || !splitNewTitle" @click="isOpenConfirmSplitDialog = true"
                        >選択した {{ selectedRecordedIds.length }} 件を新しいシリーズに分割</v-btn
                    >
                </v-card-text>
            </v-card>
        </v-container>

        <v-dialog v-model="isOpenConfirmSplitDialog" max-width="500">
            <v-card>
                <v-card-title>分割の確認</v-card-title>
                <v-card-text>選択した {{ selectedRecordedIds.length }} 件の録画を「{{ splitNewTitle }}」という新しいシリーズへ切り出します。よろしいですか？</v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="isOpenConfirmSplitDialog = false">キャンセル</v-btn>
                    <v-btn color="error" variant="text" :loading="splitting" @click="executeSplit">実行する</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </v-main>
</template>
<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISeriesApiModel, { SeriesDetail as Detail, SeriesRecording, MissingEpisodeProposal } from '@/model/api/series/ISeriesApiModel';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import * as apid from '../../../api';
import { Component, Vue, toNative } from 'vue-facing-decorator';

/**
 * 一括編集中の 1 行分の値
 */
interface BulkEdit {
    episodeNumber: number | null;
    airType: apid.SeriesAirType;
}

@Component({ components: { TitleBar } })
class SeriesDetailView extends Vue {
    detail: Detail | null = null;
    channelId: number | null = null;
    annictSyncing = false;
    annictMessage = '';
    futureProposals: MissingEpisodeProposal[] = [];
    reservingKey: string | null = null;

    isSplitMode = false;
    selectedRecordedIds: number[] = [];
    splitNewTitle = '';
    splitting = false;
    isOpenConfirmSplitDialog = false;

    isBulkMode = false;
    // 録画 ID → 編集中の話数・放送種別。保存時に元の値と比べて差分だけ送る
    edits: Record<number, BulkEdit> = {};
    sequenceStart = 1;
    bulkAirType: apid.SeriesAirType = 'delayed';
    bulkSaving = false;

    readonly airTypeItems = [
        { title: '初回', value: 'first' },
        { title: '再放送', value: 'rerun' },
        { title: '遅れ放送', value: 'delayed' },
        { title: '不明', value: 'unknown' },
    ];

    private api = container.get<ISeriesApiModel>('ISeriesApiModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
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
        void this.loadFutureProposals();
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
    async loadFutureProposals(): Promise<void> {
        try {
            this.futureProposals = await this.api.getMissingEpisodeProposals(this.id);
        } catch (err) {
            // 欠番補完提案の取得に失敗しても致命的ではないため一覧表示のみ諦める
            console.error(err);
        }
    }
    async reserveProposal(p: MissingEpisodeProposal, c: MissingEpisodeProposal['candidates'][number]): Promise<void> {
        const key = `${p.seasonNumber}-${p.episodeNumber}-${c.programId}`;
        this.reservingKey = key;
        try {
            await this.api.reserveMissingEpisode(this.id, p.seasonNumber, p.episodeNumber, c.programId);
            this.snackbarState.open({ color: 'success', text: `${c.name} を予約しました` });
            await this.loadFutureProposals();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '予約に失敗しました' });
        } finally {
            this.reservingKey = null;
        }
    }
    episodeTitle(x: SeriesRecording) {
        const label = x.episodeLabel ?? (x.episodeNumber !== null ? `第${x.episodeNumber}話` : '');
        return `${label} ${x.episodeTitle || x.recordedTitle}`.trim();
    }
    formatDate(value: number) {
        return new Date(value).toLocaleString();
    }
    /**
     * 話数・放送種別の一括編集を開始する。現在の値を編集用のバッファへ写す
     */
    startBulkEdit(): void {
        this.isBulkMode = true;
        this.selectedRecordedIds = [];
        this.resetEdits();
    }
    cancelBulkEdit(): void {
        this.isBulkMode = false;
        this.selectedRecordedIds = [];
        this.edits = {};
    }
    private resetEdits(): void {
        const edits: Record<number, BulkEdit> = {};
        for (const item of this.detail?.recorded ?? []) {
            edits[item.recordedId] = {
                episodeNumber: item.episodeNumber,
                airType: (item.airType || 'unknown') as apid.SeriesAirType,
            };
        }
        this.edits = edits;
    }
    selectAllRecorded(): void {
        this.selectedRecordedIds = (this.detail?.recorded ?? []).map(x => x.recordedId);
    }
    /**
     * 選択した録画を放送日時の古い順に並べ、開始話数から連番を振る
     */
    applySequence(): void {
        const start = Number(this.sequenceStart);
        if (Number.isFinite(start) === false) {
            this.snackbarState.open({ color: 'error', text: '開始話数を入力してください' });
            return;
        }
        const targets = (this.detail?.recorded ?? [])
            .filter(x => this.selectedRecordedIds.includes(x.recordedId))
            .sort((a, b) => a.startAt - b.startAt);
        targets.forEach((x, index) => {
            this.edits[x.recordedId].episodeNumber = start + index;
        });
    }
    /**
     * 選択した録画の放送種別 (遅れ放送・再放送など) をまとめて設定する
     */
    applyAirType(): void {
        for (const id of this.selectedRecordedIds) {
            if (typeof this.edits[id] !== 'undefined') this.edits[id].airType = this.bulkAirType;
        }
    }
    isEdited(item: SeriesRecording): boolean {
        const edit = this.edits[item.recordedId];
        if (typeof edit === 'undefined') return false;
        return edit.episodeNumber !== item.episodeNumber || edit.airType !== (item.airType || 'unknown');
    }
    /**
     * 元の値から変わった行だけを送信対象にする
     */
    get changedItems(): apid.BulkSeriesMappingItem[] {
        return (this.detail?.recorded ?? []).filter(x => this.isEdited(x)).map(x => {
            const edit = this.edits[x.recordedId];
            // 空欄 (NaN や空文字) は「話数なし」として null で送る
            const episodeNumber =
                typeof edit.episodeNumber === 'number' && Number.isFinite(edit.episodeNumber)
                    ? edit.episodeNumber
                    : null;
            return {
                recordedId: x.recordedId,
                seasonNumber: x.seasonNumber ?? 1,
                episodeNumber,
                airType: edit.airType,
            };
        });
    }
    async saveBulk(): Promise<void> {
        const items = this.changedItems;
        if (items.length === 0) return;
        this.bulkSaving = true;
        try {
            const result = await this.api.updateMappingBulk(items);
            if (result.failed.length > 0) {
                this.snackbarState.open({
                    color: 'error',
                    text: `${result.updated} 件を更新しましたが ${result.failed.length} 件失敗しました`,
                });
                console.error(result.failed);
            } else {
                this.snackbarState.open({ color: 'success', text: `${result.updated} 件を更新しました` });
            }
            await this.load();
            this.resetEdits();
            this.selectedRecordedIds = [];
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '一括更新に失敗しました' });
        } finally {
            this.bulkSaving = false;
        }
    }
    cancelSplit(): void {
        this.isSplitMode = false;
        this.selectedRecordedIds = [];
        this.splitNewTitle = '';
    }
    async executeSplit(): Promise<void> {
        this.splitting = true;
        try {
            const result = await this.api.split(this.id, this.selectedRecordedIds, this.splitNewTitle);
            this.isOpenConfirmSplitDialog = false;
            this.snackbarState.open({ color: 'success', text: `「${result.title}」として分割しました` });
            this.cancelSplit();
            await this.load();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '分割に失敗しました' });
        } finally {
            this.splitting = false;
        }
    }
}
export default toNative(SeriesDetailView);
</script>
