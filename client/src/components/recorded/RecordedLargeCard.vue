<template>
    <v-card :max-width="width" variant="flat" class="ma-1 recorded-large-card" v-bind:class="{ 'selected-color': item.isSelected === true }">
        <v-img
            aspect-ratio="1.7778"
            :min-width="width"
            :src="item.display.topThumbnailPath"
            v-on:error="onThumbnailError"
            v-on:click="gotoDetail"
            :eager="true"
        ></v-img>
        <div class="pa-2" v-on:click="gotoDetail">
            <div class="d-flex align-center">
                <div class="text text-subtitle-2 font-weight-bold">{{ item.display.name }}</div>
                <v-spacer></v-spacer>
                <RecordedItemMenu v-if="isEditMode === false" :recordedItem="item.recordedItem" v-on:stopEncode="stopEncode"></RecordedItemMenu>
            </div>
            <div class="text text-caption font-weight-light">{{ item.display.channelName }}</div>
            <div class="text text-caption font-weight-light">{{ item.display.time }} ({{ item.display.duration }} m)</div>
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

    .droped
        color: red
        font-weight: bold !important

    .dummy
        visibility: hidden
</style>
