<template>
    <v-card class="mx-auto recorded-table" max-width="1000px">
        <v-table>
            <template v-slot:default>
                <thead>
                    <tr>
                        <th>タイトル</th>
                        <th v-if="isMobile === false" class="channel">放送局</th>
                        <th class="time">時間</th>
                        <th class="menu"></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="item in items" v-bind:key="item.recordedItem.id" v-on:click="gotoDetail(item)" v-bind:class="{ 'selected-color': item.isSelected === true }">
                        <td>
                            {{ item.display.name }}
                            <div v-if="isMobile === true" class="d-flex align-center channel-line mt-1">
                                <v-img
                                    v-if="typeof item.display.logoSrc !== 'undefined'"
                                    :src="item.display.logoSrc"
                                    v-on:error="onLogoError(item)"
                                    class="channel-logo mr-1 flex-grow-0"
                                    height="16"
                                    width="28"
                                ></v-img>
                                <span class="text-caption text-medium-emphasis">{{ item.display.channelName }}</span>
                            </div>
                        </td>
                        <td v-if="isMobile === false" class="channel-cell">
                            <div class="d-flex align-center channel-line">
                                <v-img
                                    v-if="typeof item.display.logoSrc !== 'undefined'"
                                    :src="item.display.logoSrc"
                                    v-on:error="onLogoError(item)"
                                    class="channel-logo mr-1 flex-grow-0"
                                    height="16"
                                    width="28"
                                ></v-img>
                                <span>{{ item.display.channelName }}</span>
                            </div>
                        </td>
                        <td>{{ item.display.shortTime }} ({{ item.display.durationText }})</td>
                        <td class="menu">
                            <RecordedItemMenu v-if="isEditMode === false" :recordedItem="item.recordedItem" v-on:stopEncode="stopEncode"></RecordedItemMenu>
                        </td>
                    </tr>
                </tbody>
            </template>
        </v-table>
    </v-card>
</template>

<script lang="ts">
import RecordedItemMenu from '@/components/recorded/RecordedItemMenu.vue';
import { RecordedDisplayData } from '@/model/state/recorded/IRecordedUtil';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../api';

@Component({
    components: {
        RecordedItemMenu,
    },
})
class RecordedTableItems extends Vue {
    // スマホ・タブレットでは放送局列を隠し、タイトルの下にまとめて表示する
    get isMobile(): boolean {
        return this.$vuetify.display.smAndDown;
    }

    @Prop({ required: true })
    public items!: RecordedDisplayData[];

    @Prop({ required: true })
    public isEditMode!: boolean;

    @Prop({ required: true })
    public isShowDropInfo!: boolean;

    public gotoDetail(item: RecordedDisplayData): void {
        if (this.isEditMode === true) {
            this.$emit('selected', item.recordedItem.id);

            return;
        }
        this.$emit('detail', item.recordedItem.id);
    }

    public stopEncode(recordedId: apid.RecordedId): void {
        this.$emit('stopEncode', recordedId);
    }

    // ロゴ画像の取得に失敗した場合は局名だけの表示にフォールバックする
    public onLogoError(item: RecordedDisplayData): void {
        item.display.logoSrc = undefined;
    }
}

export default toNative(RecordedTableItems);
</script>

<style lang="sass" scoped>
.recorded-table
    cursor: pointer
    .channel
        min-width: 180px
    .channel-cell
        min-width: 180px
    .channel-line span
        overflow: hidden
        text-overflow: ellipsis
        white-space: nowrap
    .channel-logo
        border-radius: 2px
        flex-shrink: 0
    .time
        width: 190px
    .menu
        width: 68px

@media (max-width: 600px)
    .recorded-table
        .time
            width: 108px
        .menu
            width: 56px
</style>
