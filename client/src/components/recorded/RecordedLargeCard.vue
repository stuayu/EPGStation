<template>
    <v-card :max-width="width" variant="flat" class="ma-1 recorded-large-card" v-bind:class="{ 'selected-color': item.isSelected === true }">
        <v-img aspect-ratio="1.7778" cover :min-width="width" :src="item.display.topThumbnailPath" v-on:error="onThumbnailError" v-on:click="gotoDetail" :eager="true"></v-img>
        <div class="pa-2" v-on:click="gotoDetail">
            <div class="d-flex align-center">
                <div class="text text-subtitle-2 font-weight-bold">{{ item.display.name }}</div>
                <v-spacer></v-spacer>
                <RecordedItemMenu v-if="isEditMode === false" :recordedItem="item.recordedItem" v-on:stopEncode="stopEncode"></RecordedItemMenu>
            </div>
            <div class="text text-caption font-weight-light d-flex align-center channel-line">
                <v-img
                    v-if="typeof item.display.logoSrc !== 'undefined'"
                    :src="item.display.logoSrc"
                    v-on:error="onLogoError"
                    class="channel-logo mr-1 flex-grow-0"
                    height="16"
                    width="28"
                ></v-img>
                <span>{{ item.display.channelName }}</span>
            </div>
            <div class="text text-caption font-weight-light">{{ item.display.time }} ({{ item.display.durationText }})</div>
            <div v-if="typeof item.display.watchStatus !== 'undefined'" class="watch-progress">
                <v-chip size="x-small" :color="watchStatusColor(item.display.watchStatus)">
                    {{ watchStatusLabel(item.display.watchStatus) }}
                </v-chip>
                <v-progress-linear v-if="item.display.watchStatus === 'watching'" :model-value="item.display.watchProgress" height="3"></v-progress-linear>
            </div>
            <div
                v-if="isShowDropInfo === true && typeof item.display.drop !== 'undefined'"
                class="text text-caption font-weight-light"
                v-bind:class="{ droped: item.display.hasDrop === true }"
            >
                {{ item.display.dropSimple }}
            </div>
            <div
                v-else-if="typeof item.display.description === 'undefined' || item.display.description.replace(/\s+/g, '').length === 0"
                class="text text-caption font-weight-light dummy"
            >
                dummy
            </div>
            <div v-else class="text text-caption font-regular">{{ item.display.description }}</div>
        </div>
    </v-card>
</template>

<script lang="ts">
import RecordedItemMenu from '@/components/recorded/RecordedItemMenu.vue';
import { RecordedDisplayData } from '@/model/state/recorded/IRecordedUtil';
import WatchStatusUtil from '@/util/WatchStatusUtil';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../api';

@Component({
    components: {
        RecordedItemMenu,
    },
})
class RecordedLargeCard extends Vue {
    public onThumbnailError(_source: string | undefined): void {
        this.item.display.topThumbnailPath = './img/noimg.png';
    }

    // ロゴ画像の取得に失敗した場合は局名だけの表示にフォールバックする
    public onLogoError(_source: string | undefined): void {
        this.item.display.logoSrc = undefined;
    }

    @Prop({ required: true })
    public width!: number;

    @Prop({ required: true })
    public item!: RecordedDisplayData;

    @Prop({ required: true })
    public isEditMode!: boolean;

    @Prop({ required: true })
    public isShowDropInfo!: boolean;

    public gotoDetail(): void {
        if (this.isEditMode === true) {
            this.$emit('selected', this.item.recordedItem.id);

            return;
        }
        this.$emit('detail', this.item.recordedItem.id);
    }

    public stopEncode(recordedId: apid.RecordedId): void {
        this.$emit('stopEncode', recordedId);
    }

    public watchStatusLabel(status: apid.WatchStatus | undefined): string | null {
        return WatchStatusUtil.getLabel(status);
    }

    public watchStatusColor(status: apid.WatchStatus | undefined): string {
        return WatchStatusUtil.getColor(status);
    }
}

export default toNative(RecordedLargeCard);
</script>

<style lang="sass" scoped>
.recorded-large-card
    cursor: pointer
    .text
        overflow: hidden
        text-overflow: ellipsis
        white-space: nowrap
        min-width: 0

    .channel-line
        span
            overflow: hidden
            text-overflow: ellipsis
            white-space: nowrap
            min-width: 0

    .channel-logo
        border-radius: 2px
        flex-shrink: 0

    .droped
        color: red
        font-weight: bold !important

    .dummy
        visibility: hidden
</style>
