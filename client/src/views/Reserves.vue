<template>
    <v-main>
        <EditTitleBar
            v-if="isEditMode === true"
            :title="selectedTitle"
            v-model:isEditMode="isEditMode"
            v-on:exit="onFinishEdit"
            v-on:selectall="onSelectAll"
            v-on:delete="onMultiplueDeletion"
        ></EditTitleBar>
        <TitleBar v-else :title="title">
            <template v-slot:menu>
                <ReservesMainMenu v-on:edit="onEdit"></ReservesMainMenu>
            </template>
        </TitleBar>
        <div v-if="isEditMode === false" class="d-flex justify-end px-2 pt-2">
            <v-btn-toggle v-model="viewMode" mandatory density="compact" divided>
                <v-btn value="list" size="small">一覧</v-btn>
                <v-btn value="tuner" size="small">チューナー別</v-btn>
            </v-btn-toggle>
        </div>
        <v-alert v-if="viewMode === 'tuner'" type="info" variant="tonal" class="mx-2" density="compact">
            チューナー別表示は EPGStation 内部の計画です。実際に使うチューナーは Mirakurun が選びます。
        </v-alert>
        <v-alert v-if="viewMode === 'tuner' && isLegacyScheduler" type="info" variant="tonal" class="mx-2">新しいスケジューラでのみ表示されます</v-alert>
        <div v-if="viewMode === 'tuner' && isLegacyScheduler === false" class="pa-2">
            <div v-if="isMobile">
                <div v-for="row in tunerRows" :key="row.key" class="mb-3">
                    <div class="text-subtitle-1 font-weight-bold">{{ row.name }}</div>
                    <v-list density="compact">
                        <v-list-item v-for="reserve in row.reserves" :key="reserve.id" :title="reserve.name" :subtitle="formatReserveTime(reserve)" />
                    </v-list>
                </div>
            </div>
            <div v-else class="tuner-timeline">
                <div class="tuner-row tuner-axis">
                    <span></span>
                    <div class="tuner-track">
                        <span v-for="(hour, index) in timelineHours" :key="index" class="tuner-hour" :style="{ left: `${(index / 24) * 100}%` }">{{ hour }}</span>
                    </div>
                </div>
                <div v-for="row in tunerRows" :key="row.key" class="tuner-row">
                    <strong>{{ row.name }}</strong>
                    <div class="tuner-track">
                        <div v-for="reserve in row.reserves" :key="reserve.id" class="tuner-reserve" :style="timelineStyle(reserve)" :title="reserve.name">
                            {{ reserve.name }}
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <transition name="page">
            <div v-if="viewMode === 'list' && reservesState.getReserves().length > 0" ref="appContent" class="app-content pa-2">
                <div v-bind:style="contentWrapStyle">
                    <ReserveItems :reserves="reservesState.getReserves()" v-model:isEditMode="isEditMode" v-on:selected="selectItem"></ReserveItems>
                </div>
                <Pagination :total="reservesState.getTotal()" :pageSize="settingValue?.reservesLength ?? 0"></Pagination>
            </div>
        </transition>
        <div style="visibility: hidden">dummy</div>
        <ReserveMultipleDeletionDialog
            v-model:isOpen="isOpenMultiplueDeletionDialog"
            :total="reservesState.getSelectedCnt()"
            v-on:delete="onExecuteMultiplueDeletion"
        ></ReserveMultipleDeletionDialog>
    </v-main>
</template>

<script lang="ts">
import Pagination from '@/components/pagination/Pagination.vue';
import ReserveItems from '@/components/reserves/ReserveItems.vue';
import ReserveMultipleDeletionDialog from '@/components/reserves/ReserveMultipleDeletionDialog.vue';
import ReservesMainMenu from '@/components/reserves/ReservesMainMenu.vue';
import Snackbar from '@/components/snackbar/Snackbar.vue';
import EditTitleBar from '@/components/titleBar/EditTitleBar.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IReservesState from '@/model/state/reserve/IReservesState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { ISettingStorageModel, ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import Util from '@/util/Util';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';
import type { RouteLocationNormalized as Route } from 'vue-router';
import * as apid from '../../../api';
import { getTunerTimelineItem } from '../../../src/util/TunerTimelineUtil';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import IReservesApiModel from '@/model/api/reserves/IReservesApiModel';

@Component({
    components: {
        EditTitleBar,
        TitleBar,
        ReservesMainMenu,
        ReserveItems,
        Pagination,
        ReserveMultipleDeletionDialog,
    },
})
class Reserves extends Vue {
    public isEditMode: boolean = false;
    public isOpenMultiplueDeletionDialog: boolean = false;
    public viewMode: 'list' | 'tuner' = 'list';
    public tunerItems: apid.TunerItems = [];
    public timelineReserves: apid.ReserveItem[] = [];
    get isMobile(): boolean {
        return this.$vuetify.display.smAndDown;
    }
    private serverConfig: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');

    private isVisibilityHidden: boolean = false;
    public reservesState: IReservesState = container.get<IReservesState>('IReservesState');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    public settingValue: ISettingValue | null = null;
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    // socket.io の通知はメソッドで受ける (クラスフィールドのコールバックだと this が Vue インスタンスにならず、画面へ反映されない)
    public async onUpdateStatus(): Promise<void> {
        await this.reservesState.fetchData(this.createFetchDataOption());
    }

    get isLegacyScheduler(): boolean {
        return this.serverConfig.getConfig()?.reservationScheduler === 'legacy';
    }

    get tunerRows(): Array<{ key: string; name: string; reserves: apid.ReserveItem[] }> {
        const rows = this.tunerItems.map(tuner => ({
            key: String(tuner.index),
            name: `${tuner.name} (${tuner.types.join(', ')})${tuner.isUsing ? ' · 使用中' : ''}`,
            reserves: this.timelineReserves.filter(reserve => reserve.plannedTunerIndex === tuner.index && reserve.isConflict === false),
        }));
        const unassigned = this.timelineReserves.filter(reserve => reserve.plannedTunerIndex == null || reserve.isConflict);
        if (unassigned.length > 0) rows.push({ key: 'unassigned', name: '未割当', reserves: unassigned });
        return rows;
    }

    get timelineHours(): string[] {
        const start = this.timelineRange.start;
        return Array.from({ length: 24 }, (_, index) => new Date(start + index * 60 * 60 * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }

    get timelineRange(): { start: number; end: number } {
        const start = new Date();
        start.setMinutes(0, 0, 0);
        return { start: start.getTime(), end: start.getTime() + 24 * 60 * 60 * 1000 };
    }

    get selectedTitle(): string {
        return `${this.reservesState.getSelectedCnt()} 件選択`;
    }

    /**
     * title
     */
    get title(): string {
        switch (this.$route.query.type) {
            case 'conflict':
                return '競合';
            case 'overlap':
                return '重複';
            case 'skip':
                return '除外';
            case 'normal':
            default:
                return '予約';
        }
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
        this.$watch('viewMode', value => {
            if (value === 'tuner') void this.fetchTunerView();
        });

        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatus);
    }

    public beforeUnmount(): void {
        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatus);
    }

    public handleBeforeRouteUpdate(to: Route, from: Route, next: () => void): void {
        this.isVisibilityHidden = true;

        this.$nextTick(() => {
            next();
        });
    }

    public async fetchTunerView(): Promise<void> {
        try {
            const apiModel = container.get<IReservesApiModel>('IReservesApiModel');
            const [tuners, reserves] = await Promise.all([apiModel.getTuners(), apiModel.gets({ type: 'all', isHalfWidth: this.settingValue?.isHalfWidthDisplayed ?? false })]);
            this.tunerItems = tuners;
            this.timelineReserves = reserves.reserves;
        } catch (err) {
            this.snackbarState.open({ color: 'error', text: 'チューナー別予約の取得に失敗' });
            console.error(err);
        }
    }

    public timelineStyle(reserve: apid.ReserveItem): Record<string, string> {
        const item = getTunerTimelineItem(reserve.startAt, reserve.endAt, this.timelineRange.start, this.timelineRange.end);
        return item === null ? { display: 'none' } : { left: `${item.left}%`, width: `${item.width}%` };
    }

    public formatReserveTime(reserve: apid.ReserveItem): string {
        return `${new Date(reserve.startAt).toLocaleString()} – ${new Date(reserve.endAt).toLocaleTimeString()}`;
    }

    public onEdit(): void {
        this.isEditMode = true;
    }

    public onFinishEdit(): void {
        this.reservesState.clearSelect();
    }

    public onSelectAll(): void {
        this.reservesState.selectAll();
    }

    public selectItem(reserveId: apid.ReserveId): void {
        this.reservesState.select(reserveId);
    }

    public onMultiplueDeletion(): void {
        this.isOpenMultiplueDeletionDialog = true;
    }

    public async onExecuteMultiplueDeletion(): Promise<void> {
        this.isOpenMultiplueDeletionDialog = false;
        this.isEditMode = false;
        try {
            await this.reservesState.multiplueDeletion();
            this.snackbarState.open({
                color: 'success',
                text: '選択した番組の予約をキャンセルしました。',
            });
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: '一部番組のキャンセルに失敗しました。',
            });
        }
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.reservesState.clearDate();
        this.$nextTick(async () => {
            await this.reservesState.fetchData(this.createFetchDataOption()).catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: '予約データ取得に失敗',
                });
                console.error(err);
            });

            this.isVisibilityHidden = false;

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }

    /**
     * 予約データ取得時のオプションを生成する
     * @return GetReserveOption
     */
    private createFetchDataOption(): apid.GetReserveOption {
        if (this.settingValue === null) {
            throw new Error('SettingValueIsNull');
        }

        const type = this.$route.query.type;

        return {
            type: typeof type === 'undefined' ? 'all' : type === 'normal' || type === 'conflict' || type === 'overlap' || type === 'skip' ? type : 'normal',
            isHalfWidth: this.settingValue.isHalfWidthDisplayed,
            offset: (Util.getPageNum(this.$route) - 1) * this.settingValue.reservesLength,
            limit: this.settingValue.reservesLength,
        };
    }
}

export default Object.assign(toNative(Reserves), {
    beforeRouteUpdate(this: Reserves, to: Route, from: Route, next: () => void): void {
        this.handleBeforeRouteUpdate(to, from, next);
    },
});
</script>

<style scoped>
.tuner-row {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    gap: 12px;
    align-items: center;
    min-height: 56px;
    border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.tuner-track {
    position: relative;
    height: 44px;
    background: repeating-linear-gradient(
        90deg,
        transparent 0,
        transparent calc(4.166% - 1px),
        rgba(var(--v-border-color), 0.4) calc(4.166% - 1px),
        rgba(var(--v-border-color), 0.4) 4.166%
    );
}
.tuner-reserve {
    position: absolute;
    top: 3px;
    height: 38px;
    overflow: hidden;
    white-space: nowrap;
    padding: 8px 4px;
    border-radius: 4px;
    background: rgb(var(--v-theme-primary));
    color: rgb(var(--v-theme-on-primary));
    font-size: 12px;
}
</style>
