<template>
    <div v-if="reserves.length > 0" class="rule-reserves mx-auto my-5">
        <div class="result-text pb-2">予約数 {{ reserves.length }} 件</div>
        <ReservesCard :reserves="reserves" :isEditMode="false" :needsDecoration="true" :disableEdit="true"></ReservesCard>
    </div>
    <div v-else style="visibility: hidden">dummy</div>
</template>

<script lang="ts">
import ReservesCard from '@/components/reserves/ReservesCard.vue';
import { ReserveStateData } from '@/model/state/reserve/IReserveStateUtil';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';

@Component({
    components: {
        ReservesCard,
    },
})
class SearchReserves extends Vue {
    @Prop({
        required: true,
    })
    public reserves!: ReserveStateData[];
}

export default toNative(SearchReserves);
</script>

<style lang="sass" scoped>
.rule-reserves
    max-width: 800px

.result-text
    text-align: right
</style>
