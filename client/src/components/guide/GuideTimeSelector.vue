<template>
    <div>
        <v-menu v-model="isOpen" location="bottom end" :close-on-content-click="false">
            <template v-slot:activator="{ props }">
                <v-btn icon variant="text" v-bind="props">
                    <v-icon>mdi-calendar-clock</v-icon>
                </v-btn>
            </template>
            <v-card class="guide-time-selector">
                <v-date-picker v-model="dateValue" :min="minDate" :max="maxDate" show-adjacent-months hide-header color="primary"></v-date-picker>
                <div class="d-flex ga-2 px-4 pb-2">
                    <v-select
                        v-if="broadcastItems.length > 0"
                        :items="broadcastItems"
                        v-model="broadcastValue"
                        label="放送波"
                        density="compact"
                        variant="outlined"
                        hide-details
                    ></v-select>
                    <v-select :items="hourItems" v-model="hourValue" label="時刻" density="compact" variant="outlined" hide-details></v-select>
                </div>
                <v-card-actions>
                    <v-btn v-on:click="onNow" variant="text">現在時刻</v-btn>
                    <v-spacer></v-spacer>
                    <v-btn v-on:click="onCancel" variant="text" color="error">閉じる</v-btn>
                    <v-btn v-on:click="onShow" variant="text" color="primary">表示</v-btn>
                </v-card-actions>
            </v-card>
        </v-menu>
        <div v-if="isOpen === true" class="menu-background" v-on:click="onClickMenuBackground"></div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import { ISettingStorageModel, ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import DateUtil from '@/util/DateUtil';
import GuideRouteUtil from '@/util/GuideRouteUtil';
import Util from '@/util/Util';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';

@Component({})
class GuideTimeSelector extends Vue {
    // カレンダーで選べる範囲 (EPG は 8 日程度先まで。過去は保存期間の設定次第で残っている)
    private static readonly SELECTABLE_PAST_DAYS = 30;
    private static readonly SELECTABLE_FUTURE_DAYS = 8;

    public broadcastItems: string[] = [];
    public broadcastValue: string | undefined = undefined;
    public hourItems: {
        title: string;
        value: string;
    }[] = [];
    public hourValue: string | undefined;
    public dateValue: Date = new Date();

    public isOpen: boolean = false;

    private serverConfig: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private settingValue: ISettingValue | null = null;

    get minDate(): Date {
        return GuideTimeSelector.addDays(GuideTimeSelector.getToday(), -GuideTimeSelector.SELECTABLE_PAST_DAYS);
    }

    get maxDate(): Date {
        return GuideTimeSelector.addDays(GuideTimeSelector.getToday(), GuideTimeSelector.SELECTABLE_FUTURE_DAYS);
    }

    public created(): void {
        for (let i = 0; i < 24; i++) {
            this.hourItems.push({
                title: `${i.toString(10)}時`,
                value: ('00' + i.toString(10)).slice(-2),
            });
        }
    }

    public onCancel(): void {
        this.isOpen = false;
    }

    /**
     * 現在時刻の番組表へ移動する (time クエリを外す)
     */
    public async onNow(): Promise<void> {
        this.isOpen = false;
        await Util.move(this.$router, {
            path: '/guide',
            query: GuideRouteUtil.createQuery(this.$route, { type: this.broadcastValue }),
        });
    }

    public async onShow(): Promise<void> {
        this.isOpen = false;
        if (typeof this.hourValue === 'undefined') {
            return;
        }

        await Util.move(this.$router, {
            path: '/guide',
            query: GuideRouteUtil.createQuery(this.$route, {
                type: this.broadcastValue,
                time: DateUtil.format(this.dateValue, 'YYMMdd') + this.hourValue,
            }),
        });
    }

    public onClickMenuBackground(e: Event): boolean {
        e.stopPropagation();

        return false;
    }

    /**
     * ページ移動時
     */
    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.isOpen = false;

        this.initItem();
        this.initValue();
    }

    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === true && oldState === false) {
            this.initValue();
        }
    }

    /**
     * selector item の初期化
     */
    private initItem(): void {
        this.settingValue = this.setting.getSavedValue();
        const config = this.serverConfig.getConfig();
        if (config === null) {
            console.error('config is null');
            throw new Error('ConfigIsNull');
        }

        // 放送波 item 設定 (地域別番組表のときは放送波での絞り込みは行わない)
        this.broadcastItems =
            this.settingValue.isEnableDisplayForEachBroadcastWave === true && typeof this.$route.query.region === 'undefined'
                ? Object.keys(config.broadcast).filter(type => (config.broadcast as any)[type] === true)
                : [];
    }

    /**
     * selector value 初期化
     */
    private initValue(): void {
        this.broadcastValue =
            this.settingValue !== null && this.settingValue.isEnableDisplayForEachBroadcastWave === true && typeof this.$route.query.type === 'string'
                ? this.$route.query.type
                : undefined;

        const time = typeof this.$route.query.time === 'string' ? this.$route.query.time : null;
        this.dateValue = time === null ? GuideTimeSelector.getToday() : GuideTimeSelector.parseDate(time);
        this.hourValue = time === null ? DateUtil.format(DateUtil.getJaDate(new Date()), 'hh') : time.slice(6, 8);
    }

    /**
     * 日本時間での本日 0 時を返す
     * @return Date
     */
    private static getToday(): Date {
        const now = DateUtil.getJaDate(new Date());

        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    /**
     * YYMMddhh 形式から Date を作る
     * @param time: string
     * @return Date
     */
    private static parseDate(time: string): Date {
        const year = 2000 + parseInt(time.slice(0, 2), 10);
        const month = parseInt(time.slice(2, 4), 10) - 1;
        const day = parseInt(time.slice(4, 6), 10);
        const date = new Date(year, month, day);

        return isNaN(date.getTime()) === true ? GuideTimeSelector.getToday() : date;
    }

    private static addDays(date: Date, days: number): Date {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
    }
}

export default toNative(GuideTimeSelector);
</script>

<style lang="sass" scoped>
.guide-time-selector
    .v-date-picker
        box-shadow: none
</style>
