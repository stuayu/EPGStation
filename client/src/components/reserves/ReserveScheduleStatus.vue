<template>
    <span v-if="isFollowingSchedule === true || isTimeUndefined === true" class="reserve-schedule-status">
        <v-chip v-if="isFollowingSchedule === true" size="x-small" color="error" variant="flat" class="mr-1 status-chip">
            <v-icon start size="x-small">mdi-clock-alert-outline</v-icon>
            前番組延長のため追従中
        </v-chip>
        <v-chip v-if="isTimeUndefined === true" size="x-small" color="error" variant="outlined" class="status-chip">
            <v-icon start size="x-small">mdi-timer-sand</v-icon>
            終了時刻未定
        </v-chip>
    </span>
</template>

<script lang="ts">
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../api';

/**
 * 予約の EPG 追従状態 (前番組延長による開始待ち / 放送終了時刻未定) を表示する
 */
@Component({})
class ReserveScheduleStatus extends Vue {
    @Prop({ required: true })
    public reserveItem!: apid.ReserveItem;

    get isFollowingSchedule(): boolean {
        return this.reserveItem.isFollowingSchedule === true;
    }

    get isTimeUndefined(): boolean {
        return this.reserveItem.isTimeUndefined === true;
    }
}

export default toNative(ReserveScheduleStatus);
</script>

<style lang="sass" scoped>
.status-chip
    font-weight: bold
</style>
