<template>
    <v-content>
        <TitleBar title="ルール"></TitleBar>
        <transition name="page">
            <div v-if="ruleState.getRules().length > 0" ref="appContent" class="app-content">
                <v-container>
                    <div v-bind:style="contentWrapStyle">
                        <RuleItems :rules="ruleState.getRules()"></RuleItems>
                        <Pagination :total="ruleState.getTotal()" :pageSize="settingValue.rulesLength"></Pagination>
                    </div>
                    <v-btn v-on:click="addRule" fab dark fixed bottom right color="pink">
                        <v-icon>mdi-plus</v-icon>
                    </v-btn>
                    <div class="fab-space"></div>
                </v-container>
            </div>
        </transition>
        <Snackbar></Snackbar>
    </v-content>
</template>

<script lang="ts">
import Pagination from '@/components/pagination/Pagination.vue';
import RuleItems from '@/components/rules/RuleItems.vue';
import Snackbar from '@/components/snackbar/Snackbar.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IRuleState from '@/model/state/rule/IRuleState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import ISettingStorageModel, { ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import Util from '@/util/Util';
import { Component, Vue, Watch } from 'vue-property-decorator';
import { Route } from 'vue-router';
import * as apid from '../../../api';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

@Component({
    components: {
        TitleBar,
        RuleItems,
        Pagination,
        Snackbar,
    },
})
export default class Reserves extends Vue {
    private isVisibilityHidden: boolean = false;
    private ruleState: IRuleState = container.get<IRuleState>('IRuleState');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private settingValue: ISettingValue | null = null;
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async () => {
        await this.ruleState.fetchData(this.createFetchDataOption());
    }).bind(this);

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

        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    public beforeDestroy(): void {
        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);
    }

    public beforeRouteUpdate(to: Route, from: Route, next: () => void): void {
        this.isVisibilityHidden = true;

        this.$nextTick(() => {
            next();
        });
    }

    public addRule(): void {
        Util.move(this.$router, {
            path: '/search',
        });
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.ruleState.clearData();
        this.$nextTick(async () => {
            await this.ruleState.fetchData(this.createFetchDataOption()).catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: 'ルールデータ取得に失敗',
                });
                console.error(err);
            });

            this.isVisibilityHidden = false;

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }

    /**
     * ルールデータ取得時のオプションを生成する
     * @return apid.GetRuleOption
     */
    private createFetchDataOption(): apid.GetRuleOption {
        if (this.settingValue === null) {
            throw new Error('SettingValueIsNull');
        }

        const type = this.$route.query.type;

        return {
            offset: (Util.getPageNum(this.$route) - 1) * this.settingValue.rulesLength,
            limit: this.settingValue.rulesLength,
            type: 'normal',
        };
    }
}
</script>

<style lang="sass" scoped>
.app-content
    .fab-space
        width: 100%
        height: 80px
</style>