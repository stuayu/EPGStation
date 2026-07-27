<template>
    <v-main>
        <TitleBar :title="detail?.title || 'シリーズ詳細'">
            <template v-slot:menu>
                <v-btn v-if="isSplitMode === false" icon variant="text" size="small" @click="isSplitMode = true" title="分割">
                    <v-icon>mdi-call-split</v-icon>
                </v-btn>
                <v-btn v-else icon variant="text" size="small" @click="cancelSplit" title="分割をやめる">
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
            <v-list lines="three">
                <v-list-item v-for="item in detail.recorded" :key="item.recordedId" :to="isSplitMode === true ? undefined : `/recorded/detail/${item.recordedId}`">
                    <template #prepend>
                        <v-checkbox v-if="isSplitMode === true" v-model="selectedRecordedIds" :value="item.recordedId" hide-details density="compact"></v-checkbox>
                        <v-avatar v-else color="primary">{{ item.episodeNumber ?? '-' }}</v-avatar>
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
import { Component, Vue, toNative } from 'vue-facing-decorator';
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
