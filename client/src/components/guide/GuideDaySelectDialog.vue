<template>
    <div class="guide-day-select-dialog">
        <v-dialog v-if="isRemove === false" v-model="dialogModel" max-width="400" scrollable>
            <v-card>
                <v-date-picker v-model="dateValue" :min="minDate" :max="maxDate" show-adjacent-months hide-header color="primary"></v-date-picker>
                <v-card-actions>
                    <v-btn v-on:click="gotoNow" variant="text">現在時刻</v-btn>
                    <v-spacer></v-spacer>
                    <v-btn v-on:click="dialogModel = false" variant="text" color="error">閉じる</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts">
import DateUtil from '@/util/DateUtil';
import GuideRouteUtil from '@/util/GuideRouteUtil';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';

@Component({})
class GuideDaySelectDialog extends Vue {
    // カレンダーで選べる範囲
    private static readonly SELECTABLE_PAST_DAYS = 30;
    private static readonly SELECTABLE_FUTURE_DAYS = 8;

    @Prop({ required: true })
    public isOpen!: boolean;

    public isRemove: boolean = false;
    public dateValue: Date = new Date();

    // カレンダーの選択で自動遷移するため、開いた直後の値設定で遷移しないようにする
    private isInitializing: boolean = false;

    get minDate(): Date {
        return GuideDaySelectDialog.addDays(GuideDaySelectDialog.getToday(), -GuideDaySelectDialog.SELECTABLE_PAST_DAYS);
    }

    get maxDate(): Date {
        return GuideDaySelectDialog.addDays(GuideDaySelectDialog.getToday(), GuideDaySelectDialog.SELECTABLE_FUTURE_DAYS);
    }

    /**
     * Prop で受け取った isOpen を直接は書き換えられないので
     * getter, setter を用意する
     */
    get dialogModel(): boolean {
        return this.isOpen;
    }
    set dialogModel(value: boolean) {
        this.$emit('update:isOpen', value);
    }

    /**
     * カレンダーで日付を選んだら、その日の番組表へ移動する
     * 本日を選んだ場合は現在時刻から表示する
     */
    @Watch('dateValue')
    public async onSelectDate(): Promise<void> {
        if (this.isInitializing === true) {
            return;
        }

        const today = GuideDaySelectDialog.getToday();
        const isToday = DateUtil.format(this.dateValue, 'YYMMdd') === DateUtil.format(today, 'YYMMdd');
        const hour = isToday === true ? DateUtil.format(DateUtil.getJaDate(new Date()), 'hh') : '00';

        this.dialogModel = false;
        await Util.move(this.$router, {
            path: '/guide',
            query: GuideRouteUtil.createQuery(this.$route, {
                type: Util.getRouteString(this.$route.query.type),
                time: DateUtil.format(this.dateValue, 'YYMMdd') + hour,
            }),
        });
    }

    /**
     * 現在時刻の番組表へ移動する
     */
    public async gotoNow(): Promise<void> {
        this.dialogModel = false;
        await Util.move(this.$router, {
            path: '/guide',
            query: GuideRouteUtil.createQuery(this.$route, { type: Util.getRouteString(this.$route.query.type) }),
        });
    }

    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === true && oldState === false) {
            this.initValue();
        } else if (newState === false && oldState === true) {
            // close
            this.$nextTick(async () => {
                await Util.sleep(100);
                // dialog close アニメーションが終わったら要素を削除する
                this.isRemove = true;
                this.$nextTick(() => {
                    this.isRemove = false;
                });
            });
        }
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.dialogModel = false;
    }

    /**
     * 表示中の日付をカレンダーへ反映する
     */
    private initValue(): void {
        this.isInitializing = true;
        const time = Util.getRouteString(this.$route.query.time);
        this.dateValue = typeof time === 'undefined' ? GuideDaySelectDialog.getToday() : GuideDaySelectDialog.parseDate(time);
        this.$nextTick(() => {
            this.isInitializing = false;
        });
    }

    /**
     * 日本時間での本日 0 時を返す
     */
    private static getToday(): Date {
        const now = DateUtil.getJaDate(new Date());

        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    /**
     * YYMMddhh 形式から Date を作る
     */
    private static parseDate(time: string): Date {
        const year = 2000 + parseInt(time.slice(0, 2), 10);
        const month = parseInt(time.slice(2, 4), 10) - 1;
        const day = parseInt(time.slice(4, 6), 10);
        const date = new Date(year, month, day);

        return isNaN(date.getTime()) === true ? GuideDaySelectDialog.getToday() : date;
    }

    private static addDays(date: Date, days: number): Date {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
    }
}

export default toNative(GuideDaySelectDialog);
</script>
