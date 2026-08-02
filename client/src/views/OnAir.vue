<template>
    <v-main>
        <TitleBar title="放映中">
            <template v-slot:menu>
                <!-- 系列でまとめた表示は系列局の一覧から選ぶ -->
                <v-btn icon variant="text" size="small" title="系列局から選ぶ" v-on:click="gotoAffiliations">
                    <v-icon>mdi-television-classic</v-icon>
                </v-btn>
            </template>
            <template v-slot:extension>
                <v-tabs v-if="isTabView === true && onAirState.getSchedules().length > 0" v-model="onAirState.selectedTab" centered>
                    <v-tab v-for="item in onAirState.getTabs()" :key="item.id" :value="item.id">{{ item.name }}</v-tab>
                </v-tabs>
            </template>
        </TitleBar>
        <transition name="page">
            <div v-if="onAirState.getSchedules().length > 0">
                <v-window v-if="isTabView === true" v-model="onAirState.selectedTab">
                    <v-window-item v-for="item in onAirState.getTabs()" :key="item.id" :value="item.id">
                        <OnAirCard :items="onAirState.getSchedules(item.id)" :reserveIndex="onAirState.getReserveIndex()"></OnAirCard>
                    </v-window-item>
                </v-window>
                <div v-else>
                    <OnAirCard :items="onAirState.getSchedules()" :reserveIndex="onAirState.getReserveIndex()"></OnAirCard>
                </div>
            </div>
        </transition>
        <div style="visibility: hidden">dummy</div>
        <OnAirSelectStream></OnAirSelectStream>
        <ProgramDialog></ProgramDialog>
    </v-main>
</template>

<script lang="ts">
import ProgramDialog from '@/components/guide/ProgramDialog.vue';
import OnAirCard from '@/components/onair/OnAirCard.vue';
import OnAirSelectStream from '@/components/onair/OnAirSelectStream.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IOnAirState from '@/model/state/onair/IOnAirState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { ISettingStorageModel, ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import Util from '@/util/Util';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';
import type { RouteLocationNormalized as Route } from 'vue-router';


@Component({
    components: {
        TitleBar,
        OnAirCard,
        OnAirSelectStream,
        ProgramDialog,
    },
})
class OnAir extends Vue {
    public onAirState: IOnAirState = container.get<IOnAirState>('IOnAirState');
    private settingValue: ISettingValue = container.get<ISettingStorageModel>('ISettingStorageModel').getSavedValue();
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async (): Promise<void> => {
        await this.fetchData();
    }).bind(this);
    private updateTimer: ReturnType<typeof setTimeout> | null = null;
    private updateDigestibilityTimer: ReturnType<typeof setTimeout> | null = null;

    get isTabView(): boolean {
        return this.settingValue.isOnAirTabListView;
    }

    /**
     * 系列局の一覧へ移動する (系列を選ぶとその系列の番組表が開く)
     */
    public async gotoAffiliations(): Promise<void> {
        await Util.move(this.$router, { path: '/affiliations' });
    }

    // EIT[p/f] が流れてきたら放送中一覧を取り直す (どの局でも一覧に影響するため絞り込まない)
    private onUpdateOnAirProgramCallback = ((): void => {
        void this.fetchData().catch(() => {});
    }).bind(this);

    public created(): void {
        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
        this.socketIoModel.onUpdateOnAirProgram(this.onUpdateOnAirProgramCallback);
    }

    public beforeUnmount(): void {
        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);
        this.socketIoModel.offUpdateOnAirProgram(this.onUpdateOnAirProgramCallback);

        if (this.updateTimer !== null) {
            clearTimeout(this.updateTimer);
        }
        if (this.updateDigestibilityTimer !== null) {
            clearInterval(this.updateDigestibilityTimer);
        }
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.onAirState.clearData();
        this.$nextTick(async () => {
            await this.fetchData().catch(() => {});

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }

    @Watch('onAirState.selectedTab')
    onTabChanged(): void {
        window.scroll(0, 0);
    }

    /**
     * 番組データ取得
     * @return Promise<void>
     */
    private async fetchData(): Promise<void> {
        if (this.updateTimer !== null) {
            clearTimeout(this.updateTimer);
        }

        await this.onAirState
            .fetchData({
                isHalfWidth: this.settingValue.isHalfWidthDisplayed,
            })
            .catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: '番組情報取得に失敗',
                });

                throw err;
            });

        if (this.updateTimer !== null) {
            clearTimeout(this.updateTimer);
        }
        this.updateTimer = setTimeout(() => {
            this.fetchData();
        }, this.onAirState.getUpdateTime());

        if (this.updateDigestibilityTimer !== null) {
            clearInterval(this.updateDigestibilityTimer);
        }
        this.updateDigestibilityTimer = setInterval(() => {
            this.onAirState.updateDigestibility();
        }, 10 * 1000);
    }
}

export default toNative(OnAir);
</script>

<style lang="sass" scoped>
.v-theme--dark.v-window
    background-color: transparent !important
</style>
