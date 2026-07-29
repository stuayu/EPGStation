<template>
    <v-card :ripple="false" variant="flat" rounded="0" class="d-flex my-1 recorded-small-card" v-bind:class="{ 'selected-color': item.isSelected === true }">
        <v-img
            v-if="!!noThumbnail === false"
            aspect-ratio="1.7778"
            cover
            :src="item.display.topThumbnailPath"
            v-on:error="onThumbnailError"
            v-on:click="gotoDetail"
            eager
            class="thumbnail"
        ></v-img>
        <div v-on:click="gotoDetail" class="content pa-2 my-auto">
            <div class="d-flex align-center">
                <div class="text mt-1 text-subtitle-2 font-weight-bold">{{ item.display.name }}</div>
                <div v-if="isEditMode === false" class="menu-wrap">
                    <RecordedItemMenu :recordedItem="item.recordedItem" v-on:stopEncode="stopEncode"></RecordedItemMenu>
                </div>
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
class RecordedSmallCard extends Vue {
    public onThumbnailError(_source: string | undefined): void {
        this.item.display.topThumbnailPath = './img/noimg.png';
    }

    // ロゴ画像の取得に失敗した場合は局名だけの表示にフォールバックする
    public onLogoError(_source: string | undefined): void {
        this.item.display.logoSrc = undefined;
    }

    @Prop({ required: true })
    public item!: RecordedDisplayData;

    @Prop({ required: false })
    public noThumbnail: boolean | undefined;

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

export default toNative(RecordedSmallCard);
</script>

<style lang="sass" scoped>
.recorded-small-card
    width: 100%
    // Vuetify 3 以降のタイポグラフィでは 4 行分が 100px に収まらないため、
    // 高さ固定にすると説明文が上下で切れてカードからはみ出す
    min-height: 100px
    cursor: pointer

    .thumbnail
        flex-basis: 30%
        max-width: 200px
        border-bottom-left-radius: inherit
        border-top-right-radius: unset !important

    .content
        flex-basis: 100%
        min-width: 0
        overflow-wrap: break-word
        word-wrap: break-word
        .text
            overflow: hidden
            text-overflow: ellipsis
            white-space: nowrap
            min-width: 0
        .text-subtitle-2
            padding-right: 30px
        .dummy
            visibility: hidden

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

    .menu-wrap
        position: absolute
        right: 0
        margin-top: 2px
        margin-right: 4px
</style>
