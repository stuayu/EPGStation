<template>
    <v-main>
        <TitleBar title="視聴履歴"></TitleBar>
        <v-container>
            <div class="d-flex align-center flex-wrap ga-2 mb-3">
                <v-chip-group v-model="statusFilter" mandatory selected-class="text-primary" @update:model-value="onChangeFilter">
                    <v-chip value="all" size="small" variant="outlined">すべて</v-chip>
                    <v-chip value="watching" size="small" variant="outlined">視聴中</v-chip>
                    <v-chip value="watched" size="small" variant="outlined">視聴済み</v-chip>
                </v-chip-group>
                <v-spacer></v-spacer>
                <span class="text-caption text-grey">{{ total }} 件</span>
                <v-btn icon variant="text" size="small" :loading="isLoading" title="再読み込み" @click="fetchData">
                    <v-icon>mdi-refresh</v-icon>
                </v-btn>
            </div>

            <v-alert v-if="isEnabled === false" type="info">視聴履歴機能 (featureFlags.watchHistory) が無効です</v-alert>
            <v-alert v-else-if="isLoading === false && records.length === 0" type="info">視聴履歴はまだありません</v-alert>

            <v-list v-else lines="two" class="history-list">
                <v-list-item v-for="record in records" :key="record.videoFileId" class="history-item" @click="play(record)">
                    <template #prepend>
                        <v-img :src="thumbnailPath(record)" width="120" height="68" cover class="rounded mr-3 flex-grow-0"></v-img>
                    </template>
                    <v-list-item-title class="text-body-2 font-weight-medium">{{ title(record) }}</v-list-item-title>
                    <v-list-item-subtitle class="text-caption">
                        {{ channelName(record) }} ・ {{ formatDate(record.updatedAt) }} に視聴
                    </v-list-item-subtitle>
                    <div class="d-flex align-center ga-2 mt-1">
                        <v-chip size="x-small" :color="record.status === 'watched' ? 'success' : 'primary'" variant="tonal">
                            {{ record.status === 'watched' ? '視聴済み' : '視聴中' }}
                        </v-chip>
                        <v-progress-linear
                            :model-value="progress(record)"
                            :color="record.status === 'watched' ? 'success' : 'primary'"
                            height="4"
                            rounded
                            class="progress"
                        ></v-progress-linear>
                        <span class="text-caption text-grey position-text">{{ positionText(record) }}</span>
                    </div>
                    <template #append>
                        <v-btn
                            icon
                            variant="text"
                            size="small"
                            title="この履歴を削除"
                            @click.prevent.stop="deleteHistory(record)"
                        >
                            <v-icon size="small">mdi-delete-outline</v-icon>
                        </v-btn>
                    </template>
                </v-list-item>
            </v-list>

            <v-pagination v-if="pageCount > 1" v-model="page" :length="pageCount" density="comfortable" class="mt-3" @update:model-value="fetchData"></v-pagination>
            <WatchHistoryPlayDialog
                v-model="isOpenPlayDialog"
                v-bind:videoFile="playDialogVideoFile"
                v-bind:recordedId="playDialogRecordedId"
                v-bind:title="playDialogTitle"
            ></WatchHistoryPlayDialog>
        </v-container>
    </v-main>
</template>

<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import WatchHistoryPlayDialog from '@/components/watchHistory/WatchHistoryPlayDialog.vue';
import container from '@/model/ModelContainer';
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import { isFeatureEnabled } from '@/util/FeatureFlags';
import DateUtil from '@/util/DateUtil';
import { Component, Vue, toNative } from 'vue-facing-decorator';
import * as apid from '../../../api';

/**
 * 視聴履歴の一覧画面。
 * 最後に見た順に並べ、再生位置・視聴状態を出す。行をクリックすると続きから再生する
 */
@Component({ components: { TitleBar, WatchHistoryPlayDialog } })
class WatchHistoryView extends Vue {
    // 1 ページあたりの表示件数
    private static readonly PAGE_SIZE = 24;

    public records: apid.WatchHistoryRecord[] = [];
    public total: number = 0;
    public page: number = 1;
    public statusFilter: 'all' | 'watching' | 'watched' = 'all';
    public isLoading: boolean = false;

    // 再生方法を選ぶダイアログの状態
    public isOpenPlayDialog: boolean = false;
    public playDialogVideoFile: apid.VideoFile | null = null;
    public playDialogRecordedId: apid.RecordedId | null = null;
    public playDialogTitle: string = '';

    private videoApiModel: IVideoApiModel = container.get<IVideoApiModel>('IVideoApiModel');
    private serverConfig: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private settingStorageModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');

    get isEnabled(): boolean {
        return isFeatureEnabled(this.serverConfig.getConfig(), 'watchHistory');
    }

    get pageCount(): number {
        return Math.ceil(this.total / WatchHistoryView.PAGE_SIZE);
    }

    public mounted(): void {
        void this.fetchData();
    }

    public onChangeFilter(): void {
        this.page = 1;
        void this.fetchData();
    }

    public async fetchData(): Promise<void> {
        if (this.isEnabled === false) {
            return;
        }

        this.isLoading = true;
        try {
            const result = await this.videoApiModel.getWatchHistories({
                offset: (this.page - 1) * WatchHistoryView.PAGE_SIZE,
                limit: WatchHistoryView.PAGE_SIZE,
                status: this.statusFilter === 'all' ? undefined : this.statusFilter,
                isHalfWidth: this.settingStorageModel.getSavedValue().isHalfWidthDisplayed,
            });
            this.records = result.records;
            this.total = result.total;
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '視聴履歴の取得に失敗しました' });
        } finally {
            this.isLoading = false;
        }
    }

    public title(record: apid.WatchHistoryRecord): string {
        return record.recorded?.name ?? '(削除された録画)';
    }

    public channelName(record: apid.WatchHistoryRecord): string {
        return record.recorded?.tsChannelName ?? record.recorded?.channelName ?? '';
    }

    public thumbnailPath(record: apid.WatchHistoryRecord): string {
        const thumbnails = record.recorded?.thumbnails;

        return typeof thumbnails === 'undefined' || thumbnails.length === 0
            ? './img/noimg.png'
            : `./api/thumbnails/${thumbnails[0]}`;
    }

    /**
     * 再生位置の進捗 (%)
     */
    public progress(record: apid.WatchHistoryRecord): number {
        if (record.duration <= 0) {
            return record.status === 'watched' ? 100 : 0;
        }

        return Math.min(100, Math.round((record.position / record.duration) * 100));
    }

    public positionText(record: apid.WatchHistoryRecord): string {
        return record.duration <= 0
            ? WatchHistoryView.formatDuration(record.position)
            : `${WatchHistoryView.formatDuration(record.position)} / ${WatchHistoryView.formatDuration(record.duration)}`;
    }

    public formatDate(value: number): string {
        return DateUtil.format(DateUtil.getJaDate(new Date(value)), 'MM/dd(w) hh:mm');
    }

    /**
     * 秒数を h:mm:ss 形式にする
     */
    private static formatDuration(seconds: number): string {
        const total = Math.max(0, Math.floor(seconds));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const mm = h > 0 ? String(m).padStart(2, '0') : String(m);

        return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
    }

    /**
     * 再生方法 (そのまま再生 / ストリーミング) を選ぶダイアログを開く
     * 録画が削除済み・録画ファイルが消えている場合は開かない
     */
    public play(record: apid.WatchHistoryRecord): void {
        if (record.recorded === null || typeof record.recorded === 'undefined') {
            this.snackbarState.open({ color: 'error', text: 'この録画は削除されています' });

            return;
        }

        const videoFile = record.recorded.videoFiles?.find(video => video.id === record.videoFileId) ?? null;
        if (videoFile === null) {
            // 履歴だけ残って録画ファイルが消えている場合は詳細画面へ逃がす
            void this.$router.push(`/recorded/detail/${record.recordedId}`);

            return;
        }

        this.playDialogVideoFile = videoFile;
        this.playDialogRecordedId = record.recordedId;
        this.playDialogTitle = this.title(record);
        this.isOpenPlayDialog = true;
    }

    /**
     * 視聴履歴を 1 件削除する (録画・録画ファイルは消さない)
     */
    public async deleteHistory(record: apid.WatchHistoryRecord): Promise<void> {
        try {
            await this.videoApiModel.deleteWatchHistory(record.videoFileId);
            this.snackbarState.open({ color: 'success', text: '視聴履歴を削除しました' });
            await this.fetchData();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '視聴履歴の削除に失敗しました' });
        }
    }
}

export default toNative(WatchHistoryView);
</script>

<style lang="sass" scoped>
.history-item
    cursor: pointer

.progress
    max-width: 200px

.position-text
    white-space: nowrap
</style>
