<template>
    <div>
        <div v-for="item in items" v-bind:key="item.encodeItem.id">
            <EncodeSmallCard :item="item" v-model:isEditMode="isEditMode" v-on:selected="selected"></EncodeSmallCard>
        </div>
    </div>
</template>

<script lang="ts">
import EncodeSmallCard from '@/components/encode/EncodeSmallCard.vue';
import { EncodeInfoDisplayData } from '@/model/state/encode/IEncodeState';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../api';

@Component({
    components: {
        EncodeSmallCard,
    },
})
class EncodeItems extends Vue {
    @Prop({ required: true })
    public items!: EncodeInfoDisplayData[];

    @Prop({ required: true })
    public isEditMode!: boolean;

    public selected(encodeId: apid.EncodeId): void {
        this.$emit('selected', encodeId);
    }
}

export default toNative(EncodeItems);
</script>
