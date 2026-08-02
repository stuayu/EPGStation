<template>
    <v-main>
        <EditTitleBar
            v-if="isEditMode === true"
            :title="selectedTitle"
            v-model:isEditMode="isEditMode"
            v-on:exit="onFinishEdit"
            v-on:selectall="onSelectAll"
            v-on:encode="onMultipleEncode"
            v-on:delete="onMultiplueDeletion"
            :showEncode="true"
        ></EditTitleBar>
        <TitleBar v-else title="録画済み">
            <template v-slot:menu>
                <v-btn
                    v-if="isEnabledSeriesLibrary === true"
                    icon
                    variant="text"
                    size="small"
                    :title="isShowAsSeries === true ? '従来のフラット表示にする' : 'シリーズ表示にする'"
                    v-on:click="toggleSeriesView"
                >
                    <v-icon>{{ isShowAsSeries === true ? 'mdi-view-list' : 'mdi-folder-play' }}</v-icon>
                </v-btn>
                <RecordedSearchMenu></RecordedSearchMenu>
                <RecordedMainMenu
                    v-on:edit="onEdit"
                    v-on:cleanup="onCleanup"
                    v-on:import="onImport"
                    v-on:changedTitleDisplay="onChangedTitleDisplay"
                ></RecordedMainMenu>
            </template>
        </TitleBar>
        <template v-if="isShowAsSeries === true">
            <v-container>
                <v-alert type="info" class="mb-3">シリーズ表示 (試験的)。作品ごとにまとめて表示します。従来表示に戻すには右上のアイコンをクリックしてください。</v-alert>
                <v-text-field v-model="seriesKeyword" label="シリーズを検索" clearable prepend-inner-icon="mdi-magnify" @keyup.enter="searchSeries"></v-text-field>
                <v-row>
                    <v-col v-for="item in seriesItems" :key="item.id" cols="12" sm="6" md="4">
                        <v-card :to="`/series/${item.id}`" height="100%">
                            <v-card-title>{{ item.title }}</v-card-title>
                            <v-card-subtitle>{{ item.normalizedTitle }}</v-card-subtitle>
                        </v-card>
                    </v-col>
                </v-row>
                <v-alert v-if="seriesLoading === false && seriesItems.length === 0" type="info">シリーズがありません</v-alert>
                <div class="mt-4">
                    <div class="text-center text-caption text-grey mb-1" v-if="seriesTotal > 0">
                        {{ seriesOffset + 1 }}–{{ Math.min(seriesOffset + seriesLimit, seriesTotal) }} / {{ seriesTotal }}
                    </div>
                    <v-pagination
                        v-if="seriesTotalPages > 1"
                        v-model="seriesPage"
                        :circle="false"
                        :length="seriesTotalPages"
                        :total-visible="7"
                        @update:model-value="loadSeries"
                    ></v-pagination>
                </div>
            </v-container>
        </template>
        <transition v-else name="page">
            <div v-if="settingValue !== null && recordedState.getRecorded().length > 0" ref="appContent" class="app-content pa-1">
                <div v-bind:style="contentWrapStyle">
                    <RecordedItems
                        :recorded="recordedState.getRecorded()"
                        v-on:detail="gotoDetail"
                        v-on:stopEncode="stopEncode"
                        v-on:selected="selectItem"
                        :isTableMode="settingValue.isShowTableMode === true"
                        v-model:isEditMode="isEditMode"
                        :isShowDropInfo="settingValue.isShowDropInfoInsteadOfDescription"
                    ></RecordedItems>
                    <Pagination v-if="isEditMode === false" :total="recordedState.getTotal()" :pageSize="settingValue.recordedLength"></Pagination>
                    <div style="visibility: hidden">dummy</div>
                </div>
            </div>
        </transition>
        <RecordedMultipleDeletionDialog
            v-if="isEditMode === true"
            v-model:isOpen="isOpenMultiplueDeletionDialog"
            :total="recordedState.getSelectedCnt().cnt"
            v-on:delete="onExecuteMultiplueDeletion"
        ></RecordedMultipleDeletionDialog>
        <RecordedMultipleEncodeDialog
            v-if="isEditMode === true"
            v-model:isOpen="isOpenMultipleEncodeDialog"
            :total="recordedState.getSelectedCnt().cnt"
            v-on:encode="onExecuteMultipleEncode"
        ></RecordedMultipleEncodeDialog>
        <RecordedCleanupDialog v-model:isOpen="isOpenCleanupDialog"></RecordedCleanupDialog>
        <RecordedImportDialog v-model:isOpen="isOpenImportDialog"></RecordedImportDialog>
    </v-main>
</template>

<script lang="ts">
import Pagination from '@/components/pagination/Pagination.vue';
import RecordedCleanupDialog from '@/components/recorded/RecordedCleanupDialog.vue';
import RecordedImportDialog from '@/components/recorded/RecordedImportDialog.vue';
import RecordedItems from '@/components/recorded/RecordedItems.vue';
import RecordedMainMenu from '@/components/recorded/RecordedMainMenu.vue';
import RecordedMultipleDeletionDialog from '@/components/recorded/RecordedMultipleDeletionDialog.vue';
import RecordedMultipleEncodeDialog from '@/components/recorded/RecordedMultipleEncodeDialog.vue';
import RecordedSearchMenu from '@/components/recorded/RecordedSearchMenu.vue';
import EditTitleBar from '@/components/titleBar/EditTitleBar.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISeriesApiModel, { SeriesListItem } from '@/model/api/series/ISeriesApiModel';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IRecordedState, { MultipleDeletionOption, MultipleEncodeOption } from '@/model/state/recorded/IRecordedState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { ISettingStorageModel, ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import { isFeatureEnabled } from '@/util/FeatureFlags';
import Util from '@/util/Util';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';
import type { RouteLocationNormalized as Route } from 'vue-router';
import * as apid from '../../../api';


@Component({
    components: {
        TitleBar,
        EditTitleBar,
        RecordedSearchMenu,
        RecordedMainMenu,
        RecordedItems,
        Pagination,
        RecordedMultipleDeletionDialog,
        RecordedMultipleEncodeDialog,
        RecordedCleanupDialog,
        RecordedImportDialog,
    },
})
class Recorded extends Vue {
    public isEditMode: boolean = false;
    public isOpenMultiplueDeletionDialog: boolean = false;
    public isOpenMultipleEncodeDialog: boolean = false;
    public isOpenCleanupDialog: boolean = false;
    public isOpenImportDialog: boolean = false;

    private isVisibilityHidden: boolean = false;
    public recordedState: IRecordedState = container.get<IRecordedState>('IRecordedState');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    public settingValue: ISettingValue | null = null;
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private serverConfigModel: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');
    private seriesApi: ISeriesApiModel = container.get<ISeriesApiModel>('ISeriesApiModel');
    private onUpdateStatusCallback = (async (): Promise<void> => {
        await this.recordedState.fetchData(this.createFetchDataOption());
    }).bind(this);

    // シリーズ単位表示 (§4.4)。既定は従来のフラット表示 (isShowRecordedAsSeries の保存値に従う)
    public isShowAsSeries: boolean = false;
    public seriesItems: SeriesListItem[] = [];
    public seriesTotal = 0;
    public seriesOffset = 0;
    public seriesLimit = 30;
    public seriesLoading = false;
    public seriesKeyword = '';

    /**
     * シリーズライブラリ機能が有効か (featureFlags.seriesLibrary)。無効な場合は表示切替自体を出さない
     */
    get isEnabledSeriesLibrary(): boolean {
        return isFeatureEnabled(this.serverConfigModel.getConfig(), 'seriesLibrary');
    }

    get selectedTitle(): string {
        const info = this.recordedState.getSelectedCnt();

        return `${info.cnt} 件選択 (${Util.getFileSizeStr(info.size)})`;
    }

    get contentWrapStyle(): any {
        return this.isVisibilityHidden === false
            ? {}
            : {
                  opacity: 0,
                  visibility: 'hidden',
              };
    }

    public created(): void {
        this.settingValue = this.setting.getSavedValue();
        // 機能フラグが無効な場合は常に従来のフラット表示 (互換性維持)
        this.isShowAsSeries = this.isEnabledSeriesLibrary === true && this.settingValue.isShowRecordedAsSeries === true;
        if (this.isShowAsSeries === true) {
            void this.loadSeries();
        }

        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    /**
     * シリーズ表示 ⇔ フラット表示を切り替える
     */
    public toggleSeriesView(): void {
        this.isShowAsSeries = !this.isShowAsSeries;

        // 選択状態を次回以降の初期表示に反映する
        this.setting.tmp = { ...this.setting.getSavedValue(), isShowRecordedAsSeries: this.isShowAsSeries };
        this.setting.save();
        this.settingValue = this.setting.getSavedValue();

        if (this.isShowAsSeries === true) {
            void this.loadSeries();
        }
    }

    public async loadSeries(): Promise<void> {
        this.seriesLoading = true;
        try {
            const x = await this.seriesApi.list({ keyword: this.seriesKeyword, offset: this.seriesOffset, limit: this.seriesLimit });
            this.seriesItems = x.items;
            this.seriesTotal = x.total;
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'シリーズ一覧の取得に失敗しました' });
        } finally {
            this.seriesLoading = false;
        }
    }

    /**
     * シリーズ表示のページャ現在ページ (1 始まり)
     */
    get seriesPage(): number {
        return Math.floor(this.seriesOffset / this.seriesLimit) + 1;
    }
    set seriesPage(value: number) {
        this.seriesOffset = Math.max(0, (value - 1) * this.seriesLimit);
    }

    get seriesTotalPages(): number {
        return this.seriesTotal === 0 ? 1 : Math.ceil(this.seriesTotal / this.seriesLimit);
    }

    /**
     * キーワード検索し直すときは 1 ページ目へ戻す
     */
    public searchSeries(): void {
        this.seriesOffset = 0;
        void this.loadSeries();
    }

    public beforeUnmount(): void {
        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);
    }

    public handleBeforeRouteUpdate(to: Route, from: Route, next: () => void): void {
        this.isVisibilityHidden = true;

        this.$nextTick(() => {
            next();
        });
    }

    public gotoDetail(recordedId: apid.RecordedId): void {
        Util.move(this.$router, { path: `/recorded/detail/${recordedId.toString(10)}` });
    }

    public async stopEncode(recordedId: apid.RecordedId): Promise<void> {
        try {
            await this.recordedState.stopEncode(recordedId);
            this.snackbarState.open({
                color: 'success',
                text: 'エンコード停止',
            });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: 'エンコード停止に失敗',
            });
        }
    }

    public onEdit(): void {
        this.isEditMode = true;
    }

    public onFinishEdit(): void {
        this.recordedState.clearSelect();
    }

    public onSelectAll(): void {
        this.recordedState.selectAll();
    }

    public selectItem(recordedId: apid.RecordedId): void {
        this.recordedState.select(recordedId);
    }

    public onMultiplueDeletion(): void {
        this.isOpenMultiplueDeletionDialog = true;
    }

    public async onExecuteMultiplueDeletion(option: MultipleDeletionOption): Promise<void> {
        this.isOpenMultiplueDeletionDialog = false;
        this.isEditMode = false;
        try {
            await this.recordedState.multiplueDeletion(option);
            this.snackbarState.open({
                color: 'success',
                text: '選択した番組を削除しました。',
            });
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: '一部番組の削除に失敗しました。',
            });
        }
    }

    /**
     * 複数選択エンコードのダイアログを開く
     */
    public onMultipleEncode(): void {
        if (this.recordedState.getSelectedCnt().cnt === 0) {
            this.snackbarState.open({
                color: 'error',
                text: '番組が選択されていません。',
            });

            return;
        }

        this.isOpenMultipleEncodeDialog = true;
    }

    /**
     * 選択した番組をまとめてエンコードキューへ追加する
     * @param option: MultipleEncodeOption
     */
    public async onExecuteMultipleEncode(option: MultipleEncodeOption): Promise<void> {
        this.isOpenMultipleEncodeDialog = false;
        this.isEditMode = false;

        try {
            const result = await this.recordedState.multipleEncode(option);

            if (result.errorCnt > 0) {
                this.snackbarState.open({
                    color: 'error',
                    text: `${result.successCnt} 件を追加しましたが ${result.errorCnt} 件の追加に失敗しました。`,
                });
            } else if (result.skippedCnt > 0) {
                this.snackbarState.open({
                    color: 'info',
                    text: `${result.successCnt} 件をエンコードに追加しました (対象ファイルが無い ${result.skippedCnt} 件は除外)。`,
                });
            } else {
                this.snackbarState.open({
                    color: 'success',
                    text: `${result.successCnt} 件をエンコードに追加しました。`,
                });
            }
        } catch (err) {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: 'エンコード追加に失敗しました。',
            });
        }
    }

    public onCleanup(): void {
        this.isOpenCleanupDialog = true;
    }

    public onImport(): void {
        this.isOpenImportDialog = true;
    }

    /**
     * タイトルの表示方法が変わったので一覧を取得し直す
     * (表示名は RecordedUtil が設定を見て組み立てるため、再取得すれば反映される)
     */
    public async onChangedTitleDisplay(): Promise<void> {
        await this.recordedState.fetchData(this.createFetchDataOption()).catch(err => {
            console.error(err);
        });
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.recordedState.clearData();
        this.$nextTick(async () => {
            await this.recordedState.fetchData(this.createFetchDataOption()).catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: '録画データ取得に失敗',
                });
                console.error(err);
            });

            this.isVisibilityHidden = false;

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }

    /**
     * 録画データ取得時のオプションを生成する
     * @return GetReserveOption
     */
    private createFetchDataOption(): apid.GetRecordedOption {
        if (this.settingValue === null) {
            throw new Error('SettingValueIsNull');
        }

        const option: apid.GetRecordedOption = {
            isHalfWidth: this.settingValue.isHalfWidthDisplayed,
            offset: (Util.getPageNum(this.$route) - 1) * this.settingValue.recordedLength,
            limit: this.settingValue.recordedLength,
        };

        // query から読み取り
        if (typeof this.$route.query.keyword === 'string') {
            option.keyword = this.$route.query.keyword;
        }
        if (typeof this.$route.query.ruleId !== 'undefined') {
            option.ruleId = parseInt(this.$route.query.ruleId as string, 10);
        }
        if (typeof this.$route.query.channelId !== 'undefined') {
            option.channelId = parseInt(this.$route.query.channelId as string, 10);
        }
        if (typeof this.$route.query.genre !== 'undefined') {
            option.genre = parseInt(this.$route.query.genre as string, 10);
        }
        if (typeof this.$route.query.hasOriginalFile !== 'undefined') {
            option.hasOriginalFile = (this.$route.query.hasOriginalFile as any) === true || this.$route.query.hasOriginalFile === 'true';
        }
        if (typeof this.$route.query.tagId !== 'undefined') {
            option.tagId = parseInt(this.$route.query.tagId as string, 10);
        }

        return option;
    }
}

export default Object.assign(toNative(Recorded), {
    beforeRouteUpdate(this: Recorded, to: Route, from: Route, next: () => void): void {
            this.handleBeforeRouteUpdate(to, from, next);
        },
});
</script>
