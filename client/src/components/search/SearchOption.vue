<template>
    <div class="search-option mx-auto">
        <v-switch v-model="searchState.isTimeSpecification" :disabled="searchState.isEditingRule() === true" label="時刻指定" class="my-3"></v-switch>
        <v-card v-if="searchState.isTimeSpecification === false">
            <div class="pa-4">
                <SearchOptionRow title="キーワード">
                    <v-text-field v-model="searchState.searchOption.keyword" label="keyword" clearable v-on:keydown.enter="onKeywordEnter" ref="keyword"></v-text-field>
                    <div class="d-flex flex-wrap">
                        <v-checkbox v-model="searchState.searchOption.keywordOption.keyCS" class="mx-1 my-0" label="大小区別"></v-checkbox>
                        <v-checkbox v-model="searchState.searchOption.keywordOption.keyRegExp" class="mx-1 my-0" label="正規表現"></v-checkbox>
                        <v-checkbox v-model="searchState.searchOption.keywordOption.name" class="mx-1 my-0" label="名前"></v-checkbox>
                        <v-checkbox v-model="searchState.searchOption.keywordOption.description" class="mx-1 my-0" label="概要"></v-checkbox>
                        <v-checkbox v-model="searchState.searchOption.keywordOption.extended" class="mx-1 my-0" label="詳細"></v-checkbox>
                    </div>
                </SearchOptionRow>
                <SearchOptionRow title="除外キーワード">
                    <v-text-field v-model="searchState.searchOption.ignoreKeyword" label="ignore keyword" clearable v-on:keydown.enter="onKeywordEnter"></v-text-field>
                    <div class="d-flex flex-wrap">
                        <v-checkbox v-model="searchState.searchOption.ignoreKeywordOption.keyCS" class="mx-1 my-0" label="大小区別"></v-checkbox>
                        <v-checkbox v-model="searchState.searchOption.ignoreKeywordOption.keyRegExp" class="mx-1 my-0" label="正規表現"></v-checkbox>
                        <v-checkbox v-model="searchState.searchOption.ignoreKeywordOption.name" class="mx-1 my-0" label="名前"></v-checkbox>
                        <v-checkbox v-model="searchState.searchOption.ignoreKeywordOption.description" class="mx-1 my-0" label="概要"></v-checkbox>
                        <v-checkbox v-model="searchState.searchOption.ignoreKeywordOption.extended" class="mx-1 my-0" label="詳細"></v-checkbox>
                    </div>
                </SearchOptionRow>
                <SearchOptionRow title="放送局">
                    <v-select
                        :items="searchState.getChannelItems()"
                        v-model="searchState.searchOption.channels"
                        label="channel"
                        multiple
                        clearable
                        :menu-props="{ auto: true }"
                    ></v-select>
                    <div class="d-flex flex-wrap">
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.GR.isShow"
                            v-model="searchState.searchOption.broadcastWave.GR.isEnable"
                            class="mx-1 my-0"
                            label="GR"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.BS.isShow"
                            v-model="searchState.searchOption.broadcastWave.BS.isEnable"
                            class="mx-1 my-0"
                            label="BS"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.CS.isShow"
                            v-model="searchState.searchOption.broadcastWave.CS.isEnable"
                            class="mx-1 my-0"
                            label="CS"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.SKY.isShow"
                            v-model="searchState.searchOption.broadcastWave.SKY.isEnable"
                            class="mx-1 my-0"
                            label="SKY"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW1.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW1.isEnable"
                            class="mx-1 my-0"
                            label="NW1"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW2.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW2.isEnable"
                            class="mx-1 my-0"
                            label="NW2"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW3.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW3.isEnable"
                            class="mx-1 my-0"
                            label="NW3"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW4.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW4.isEnable"
                            class="mx-1 my-0"
                            label="NW4"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW5.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW5.isEnable"
                            class="mx-1 my-0"
                            label="NW5"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW6.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW6.isEnable"
                            class="mx-1 my-0"
                            label="NW6"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW7.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW7.isEnable"
                            class="mx-1 my-0"
                            label="NW7"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW8.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW8.isEnable"
                            class="mx-1 my-0"
                            label="NW8"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW9.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW9.isEnable"
                            class="mx-1 my-0"
                            label="NW9"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW10.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW10.isEnable"
                            class="mx-1 my-0"
                            label="NW10"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW11.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW11.isEnable"
                            class="mx-1 my-0"
                            label="NW11"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW12.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW12.isEnable"
                            class="mx-1 my-0"
                            label="NW12"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW13.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW13.isEnable"
                            class="mx-1 my-0"
                            label="NW13"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW14.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW14.isEnable"
                            class="mx-1 my-0"
                            label="NW14"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW15.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW15.isEnable"
                            class="mx-1 my-0"
                            label="NW15"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW16.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW16.isEnable"
                            class="mx-1 my-0"
                            label="NW16"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW17.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW17.isEnable"
                            class="mx-1 my-0"
                            label="NW17"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW18.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW18.isEnable"
                            class="mx-1 my-0"
                            label="NW18"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW19.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW19.isEnable"
                            class="mx-1 my-0"
                            label="NW19"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW20.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW20.isEnable"
                            class="mx-1 my-0"
                            label="NW20"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW21.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW21.isEnable"
                            class="mx-1 my-0"
                            label="NW21"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW22.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW22.isEnable"
                            class="mx-1 my-0"
                            label="NW22"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW23.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW23.isEnable"
                            class="mx-1 my-0"
                            label="NW23"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW24.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW24.isEnable"
                            class="mx-1 my-0"
                            label="NW24"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW25.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW25.isEnable"
                            class="mx-1 my-0"
                            label="NW25"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW26.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW26.isEnable"
                            class="mx-1 my-0"
                            label="NW26"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW27.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW27.isEnable"
                            class="mx-1 my-0"
                            label="NW27"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW28.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW28.isEnable"
                            class="mx-1 my-0"
                            label="NW28"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW29.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW29.isEnable"
                            class="mx-1 my-0"
                            label="NW29"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW30.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW30.isEnable"
                            class="mx-1 my-0"
                            label="NW30"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW31.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW31.isEnable"
                            class="mx-1 my-0"
                            label="NW31"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW32.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW32.isEnable"
                            class="mx-1 my-0"
                            label="NW32"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW33.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW33.isEnable"
                            class="mx-1 my-0"
                            label="NW33"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW34.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW34.isEnable"
                            class="mx-1 my-0"
                            label="NW34"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW35.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW35.isEnable"
                            class="mx-1 my-0"
                            label="NW35"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW36.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW36.isEnable"
                            class="mx-1 my-0"
                            label="NW36"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW37.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW37.isEnable"
                            class="mx-1 my-0"
                            label="NW37"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW38.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW38.isEnable"
                            class="mx-1 my-0"
                            label="NW38"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW39.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW39.isEnable"
                            class="mx-1 my-0"
                            label="NW39"
                        ></v-checkbox>
                        <v-checkbox
                            v-if="searchState.searchOption.broadcastWave.NW40.isShow"
                            v-model="searchState.searchOption.broadcastWave.NW40.isEnable"
                            class="mx-1 my-0"
                            label="NW40"
                        ></v-checkbox>
                    </div>
                </SearchOptionRow>
                <SearchOptionRow title="ジャンル">
                    <SearchGenreOption></SearchGenreOption>
                </SearchOptionRow>
                <SearchOptionRow title="時刻">
                    <div class="d-flex align-center">
                        <v-select
                            class="start-time-select"
                            label="start"
                            :items="searchState.getStartTimeItems()"
                            v-model="searchState.searchOption.startTime"
                            clearable
                            :menu-props="{ auto: true }"
                        ></v-select>
                        <span class="px-2">~</span>
                        <v-select
                            class="range-time-select"
                            label="range"
                            :items="searchState.getRangeTimeItems()"
                            v-model="searchState.searchOption.rangeTime"
                            clearable
                            :menu-props="{ auto: true }"
                        ></v-select>
                    </div>
                    <div class="d-flex flex-wrap">
                        <v-checkbox v-model="searchState.searchOption.week.mon" class="mx-1 my-0" label="月"></v-checkbox>
                        <v-checkbox v-model="searchState.searchOption.week.tue" class="mx-1 my-0" label="火"></v-checkbox>
                        <v-checkbox v-model="searchState.searchOption.week.wed" class="mx-1 my-0" label="水"></v-checkbox>
                        <v-checkbox v-model="searchState.searchOption.week.thu" class="mx-1 my-0" label="木"></v-checkbox>
                        <v-checkbox v-model="searchState.searchOption.week.fri" class="mx-1 my-0" label="金"></v-checkbox>
                        <v-checkbox v-model="searchState.searchOption.week.sat" class="mx-1 my-0" label="土"></v-checkbox>
                        <v-checkbox v-model="searchState.searchOption.week.sun" class="mx-1 my-0" label="日"></v-checkbox>
                    </div>
                </SearchOptionRow>
                <SearchOptionRow title="長さ">
                    <div class="d-flex flex-wrap">
                        <v-text-field v-model.number="searchState.searchOption.durationMin" min="0" class="duration" label="最小(分)" type="number" clearable></v-text-field>
                        <span class="px-1"></span>
                        <v-text-field v-model.number="searchState.searchOption.durationMax" min="0" class="duration" label="最大(分)" type="number" clearable></v-text-field>
                    </div>
                </SearchOptionRow>
                <SearchOptionRow title="期間">
                    <div class="d-flex flex-wrap">
                        <v-datetime-picker
                            v-if="searchState.isShowPeriod === true"
                            label="開始"
                            clearText="クリア"
                            okText="設定"
                            v-model="searchState.searchOption.startPeriod"
                            :datePickerProps="{
                                locale: 'jp-ja',
                                'day-format': date => new Date(date).getDate(),
                                'first-day-of-week': 1,
                            }"
                            :timePickerProps="{
                                'ampm-in-title': true,
                            }"
                            :textFieldProps="{
                                color: 'success',
                            }"
                        >
                            <template slot="actions" slot-scope="{ parent }">
                                <v-btn text color="primary" @click.native="parent.clearHandler">クリア</v-btn>
                                <v-btn text color="primary" @click="parent.okHandler">設定</v-btn>
                            </template>
                        </v-datetime-picker>
                        <span class="px-1"></span>
                        <v-datetime-picker
                            v-if="searchState.isShowPeriod === true"
                            label="終了"
                            clearText="クリア"
                            okText="設定"
                            v-model="searchState.searchOption.endPeriod"
                            :datePickerProps="{
                                locale: 'jp-ja',
                                'day-format': date => new Date(date).getDate(),
                                'first-day-of-week': 1,
                            }"
                            :timePickerProps="{
                                'ampm-in-title': true,
                            }"
                        >
                            <template slot="actions" slot-scope="{ parent }">
                                <v-btn text color="primary" @click.native="parent.clearHandler">クリア</v-btn>
                                <v-btn text color="primary" @click="parent.okHandler">設定</v-btn>
                            </template>
                        </v-datetime-picker>
                    </div>
                </SearchOptionRow>
                <SearchOptionRow title="その他">
                    <div class="d-flex flex-wrap">
                        <v-checkbox v-model="searchState.searchOption.isFree" class="mx-1 my-0" label="無料放送"></v-checkbox>
                    </div>
                </SearchOptionRow>
            </div>
            <v-divider></v-divider>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn v-on:click="onClickClear" text color="error">クリア</v-btn>
                <v-btn v-on:click="onClickSearch" text color="primary">検索</v-btn>
            </v-card-actions>
        </v-card>
        <v-card v-else>
            <div class="pa-4 pb-7">
                <SearchOptionRow title="番組名">
                    <v-text-field v-model="searchState.timeReserveOption.keyword" label="keyword" clearable></v-text-field>
                </SearchOptionRow>
                <SearchOptionRow title="放送局">
                    <v-select
                        :items="searchState.getChannelItems()"
                        v-model="searchState.timeReserveOption.channel"
                        label="channel"
                        clearable
                        :menu-props="{ auto: false }"
                    ></v-select>
                </SearchOptionRow>
                <SearchOptionRow title="時刻">
                    <div class="d-flex align-center">
                        <v-dialog ref="dialog0" v-model="isOpenStartTimepicker" :return-value.sync="searchState.timeReserveOption.startTime" persistent width="300px">
                            <template v-slot:activator="{ on }">
                                <v-text-field
                                    class="time-select"
                                    v-model="searchState.timeReserveOption.startTime"
                                    label="開始"
                                    prepend-icon="access_time"
                                    readonly
                                    v-on="on"
                                ></v-text-field>
                            </template>
                            <v-time-picker v-if="isOpenStartTimepicker" v-model="searchState.timeReserveOption.startTime" format="24hr" full-width>
                                <v-spacer></v-spacer>
                                <v-btn text color="primary" @click="isOpenStartTimepicker = false">Cancel</v-btn>
                                <v-btn text color="primary" @click="$refs.dialog0.save(searchState.timeReserveOption.startTime)">OK</v-btn>
                            </v-time-picker>
                        </v-dialog>
                        <span class="px-2">~</span>
                        <v-dialog ref="dialog1" v-model="isOpenEndTimepicker" :return-value.sync="searchState.timeReserveOption.endTime" persistent width="300px">
                            <template v-slot:activator="{ on }">
                                <v-text-field
                                    class="time-select"
                                    v-model="searchState.timeReserveOption.endTime"
                                    label="終了"
                                    prepend-icon="access_time"
                                    readonly
                                    v-on="on"
                                ></v-text-field>
                            </template>
                            <v-time-picker v-if="isOpenEndTimepicker" v-model="searchState.timeReserveOption.endTime" format="24hr" full-width>
                                <v-spacer></v-spacer>
                                <v-btn text color="primary" @click="isOpenEndTimepicker = false">Cancel</v-btn>
                                <v-btn text color="primary" @click="$refs.dialog1.save(searchState.timeReserveOption.endTime)">OK</v-btn>
                            </v-time-picker>
                        </v-dialog>
                    </div>
                    <div class="d-flex flex-wrap">
                        <v-checkbox v-model="searchState.timeReserveOption.week.mon" class="mx-1 my-0" label="月"></v-checkbox>
                        <v-checkbox v-model="searchState.timeReserveOption.week.tue" class="mx-1 my-0" label="火"></v-checkbox>
                        <v-checkbox v-model="searchState.timeReserveOption.week.wed" class="mx-1 my-0" label="水"></v-checkbox>
                        <v-checkbox v-model="searchState.timeReserveOption.week.thu" class="mx-1 my-0" label="木"></v-checkbox>
                        <v-checkbox v-model="searchState.timeReserveOption.week.fri" class="mx-1 my-0" label="金"></v-checkbox>
                        <v-checkbox v-model="searchState.timeReserveOption.week.sat" class="mx-1 my-0" label="土"></v-checkbox>
                        <v-checkbox v-model="searchState.timeReserveOption.week.sun" class="mx-1 my-0" label="日"></v-checkbox>
                    </div>
                </SearchOptionRow>
            </div>
        </v-card>
    </div>
</template>

<script lang="ts">
import SearchGenreOption from '@/components/search/SearchGenreOption.vue';
import SearchOptionRow from '@/components/search/SearchOptionRow.vue';
import container from '@/model/ModelContainer';
import ISearchState from '@/model/state/search/ISearchState';
import VuetifyUtil from '@/util/VuetifyUtil';
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component({
    components: {
        SearchOptionRow,
        SearchGenreOption,
    },
})
export default class SearchOption extends Vue {
    public searchState: ISearchState = container.get<ISearchState>('ISearchState');

    public isOpenStartTimepicker: boolean = false;
    public isOpenEndTimepicker: boolean = false;

    public mounted(): void {
        if (typeof this.$refs.keyword !== 'undefined') {
            VuetifyUtil.focusTextFiled(this.$refs.keyword as Vue);
        }
    }

    public onKeywordEnter(e: Event): void {
        // フォーカスを外す
        if (e.target !== null) {
            (e.target as HTMLElement).blur();
        }

        this.onClickSearch();
    }

    public onClickSearch(): void {
        this.$emit('search');
    }

    public onClickClear(): void {
        this.$emit('clear');
    }
}
</script>

<style lang="sass">
.search-option
    max-width: 800px
    .start-time-select, .time-select
        max-width: 100px
    .range-time-select
        max-width: 120px
    .duration
        max-width: 100px
</style>

<style lang="sass">
.search-option
    .v-input__control
        .v-input__slot
            margin: 0 !important
        .v-messages
            display: none
</style>
