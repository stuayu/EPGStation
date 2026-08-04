<template>
    <div>
        <v-card class="mx-auto reserves-table" max-width="1600px">
            <v-table>
                <template v-slot:default>
                    <thead>
                        <tr>
                            <th v-if="isMobile === false" class="channel">放送局</th>
                            <th class="day">日付</th>
                            <th class="time">時間</th>
                            <th>番組名</th>
                            <th v-if="isMobile === false">内容</th>
                            <th class="menu"></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="reserve in reserves"
                            v-bind:key="reserve.reserveItem.id"
                            v-bind:class="{ 'selected-color': reserve.isSelected === true }"
                            v-on:click="clickItem(reserve)"
                        >
                            <td v-if="isMobile === false">{{ reserve.display.channelName }}</td>
                            <td>{{ reserve.display.day }}({{ reserve.display.dow }})</td>
                            <td>
                                {{ reserve.display.startTime }}~<span v-bind:class="{ 'text-error font-weight-bold': reserve.reserveItem.isTimeUndefined === true }">{{ reserve.display.endTime }}</span>
                                <div>({{ reserve.display.duration }}m)</div>
                            </td>
                            <td>
                                <v-icon v-if="reserve.display.isRule === true" class="reserve-icon">mdi-calendar</v-icon>
                                <v-icon v-else class="reserve-icon">mdi-timer-outline</v-icon>
                                {{ reserve.display.name }}
                                <div v-if="isMobile === true" class="text-caption text-medium-emphasis">{{ reserve.display.channelName }}</div>
                                <ReserveScheduleStatus :reserveItem="reserve.reserveItem" class="d-block mt-1"></ReserveScheduleStatus>
                            </td>
                            <td v-if="isMobile === false">{{ reserve.display.description }}</td>
                            <td>
                                <ReserveMenu v-if="isEditMode === false" :reserveItem="reserve.reserveItem" :disableEdit="false"></ReserveMenu>
                            </td>
                        </tr>
                    </tbody>
                </template>
            </v-table>
        </v-card>
        <ReserveDialog v-model:isOpen="isOpenDialog" :reserve="dialogReserve"></ReserveDialog>
    </div>
</template>

<script lang="ts">
import ReserveDialog from '@/components/reserves/ReserveDialog.vue';
import ReserveMenu from '@/components/reserves/ReserveMenu.vue';
import ReserveScheduleStatus from '@/components/reserves/ReserveScheduleStatus.vue';
import { ReserveStateData } from '@/model/state/reserve/IReserveStateUtil';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';

@Component({
    components: {
        ReserveMenu,
        ReserveDialog,
        ReserveScheduleStatus,
    },
})
class ReservesTableItems extends Vue {
    // スマホ・タブレットでは放送局・内容列を隠し、番組名の下にまとめて表示する
    get isMobile(): boolean {
        return this.$vuetify.display.smAndDown;
    }

    @Prop({
        required: true,
    })
    public reserves!: ReserveStateData[];

    @Prop({ required: true })
    public isEditMode!: boolean;

    public isOpenDialog: boolean = false;
    public dialogReserve: ReserveStateData | null = null;

    public clickItem(reserve: ReserveStateData): void {
        if (this.isEditMode === true) {
            this.$emit('selected', reserve.reserveItem.id);

            return;
        }

        this.dialogReserve = reserve;
        this.isOpenDialog = true;
    }
}

export default toNative(ReservesTableItems);
</script>

<style lang="sass" scoped>
.reserves-table
    cursor: pointer
    .channel
        min-width: 160px
    .day
        min-width: 96px
    .time
        min-width: 110px
    .menu
        width: 68px

    tbody > tr > td
        padding-top: 8px !important
        padding-bottom: 8px !important

    .reserve-icon
        font-size: 20px !important
        padding-bottom: 2px
</style>
