<template>
    <v-content>
        <TitleBar title="放映中">
            <template v-slot:extension>
                <v-tabs
                    v-if="isTabView === true && onAirState.getSchedules().length > 0"
                    v-model="onAirState.selectedTab"
                    centered
                >
                    <v-tab v-for="item in onAirState.getTabs()" :key="item" :href="`#${item}`">{{ item }}</v-tab>
                </v-tabs>
            </template>
        </TitleBar>
        <transition name="page">
            <div v-if="onAirState.getSchedules().length > 0">
                <v-tabs-items v-if="isTabView === true" v-model="onAirState.selectedTab">
                    <v-tab-item v-for="item in onAirState.getTabs()" :key="item" :value="`${item}`">
                        <OnAirCard :items="onAirState.getSchedules(item)"></OnAirCard>
                    </v-tab-item>
                </v-tabs-items>
                <div v-else>
                    <OnAirCard :items="onAirState.getSchedules()"></OnAirCard>
                </div>
            </div>
        </transition>
        <div style="visibility: hidden;">dummy</div>
        <OnAirSelectStream></OnAirSelectStream>
        <Snackbar></Snackbar>
    </v-content>
</template>

<script lang="ts">
import OnAirCard from '@/components/onair/OnAirCard.vue';
import OnAirSelectStream from '@/components/onair/OnAirSelectStream.vue';
import Snackbar from '@/components/snackbar/Snackbar.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IOnAirState from '@/model/state/onair/IOnAirState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import ISettingStorageModel, { ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import Util from '@/util/Util';
import { Component, Vue, Watch } from 'vue-property-decorator';
import { Route } from 'vue-router';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

@Component({
    components: {
        TitleBar,
        Snackbar,
        OnAirCard,
        OnAirSelectStream,
    },
})
export default class OnAir extends Vue {
    public onAirState: IOnAirState = container.get<IOnAirState>('IOnAirState');
    private settingValue: ISettingValue = container.get<ISettingStorageModel>('ISettingStorageModel').getSavedValue();
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async () => {
        await this.fetchData();
    }).bind(this);
    private updateTimer: number | null = null;

    get isTabView(): boolean {
        return this.settingValue.isOnAirTabListView;
    }

    public created(): void {
        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    public beforeDestroy(): void {
        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);

        if (this.updateTimer !== null) {
            clearTimeout(this.updateTimer);
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
                isHalfWidth: this.settingValue.isOnAirHalfWidthDisplayed,
            })
            .catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: '番組情報取得に失敗',
                });

                throw err;
            });

        this.updateTimer = setTimeout(() => {
            this.fetchData();
        }, this.onAirState.getUpdateTime());
    }
}
</script>