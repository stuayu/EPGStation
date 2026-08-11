<template>
    <div class="on-air pa-2">
        <v-card v-if="items.length > 0" class="mx-auto pa-4" max-width="800">
            <div v-for="item in items" v-bind:key="item.display.channelId" v-on:click="openStreamSelector(item.schedule.channel)">
                <div class="py-2" style="cursor: pointer">
                    <div class="d-flex align-center mb-1">
                        <div v-on:click="openGuideProgramDialog(item.schedule, $event)" class="d-flex align-center flex-grow-1 channel-head">
                            <img v-if="typeof item.display.logoSrc !== 'undefined'" :src="item.display.logoSrc" height="24" class="pr-2" />
                            <div class="pt-1 text-subtitle-1 font-weight-black">{{ item.display.channelName }}</div>
                        </div>
                        <v-btn
                            icon
                            variant="text"
                            size="x-small"
                            :title="isPinned(item.display.channelId) === true ? 'ピン留めを解除' : 'ピン留めする'"
                            v-on:click.stop="togglePin(item.display.channelId)"
                        >
                            <v-icon size="small">{{ isPinned(item.display.channelId) === true ? 'mdi-pin' : 'mdi-pin-outline' }}</v-icon>
                        </v-btn>
                    </div>
                    <div class="text-caption font-weight-light">{{ item.display.time }}</div>
                    <div class="mb-1 text-subtitle-2">
                        {{ item.display.name }}
                    </div>
                    <div class="text-body-2 font-weight-light">{{ item.display.description }}</div>

                    <div class="pt-3">
                        <v-progress-linear buffer-value="100" :model-value="item.display.digestibility"></v-progress-linear>
                    </div>
                </div>
            </div>
        </v-card>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IGuideProgramDialogState, { ProgramDialogOpenOption } from '@/model/state/guide/IGuideProgramDialogState';
import { ReserveStateItemIndex } from '@/model/state/guide/IGuideReserveUtil';
import IOnAirSelectStreamState from '@/model/state/onair/IOnAirSelectStreamState';
import IOnAirState, { OnAirDisplayData } from '@/model/state/onair/IOnAirState';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../api';

@Component({})
class OnAirCard extends Vue {
    @Prop({ required: true })
    public items!: OnAirDisplayData[];

    @Prop({ required: true })
    public reserveIndex!: ReserveStateItemIndex;

    private streamSelectDialog: IOnAirSelectStreamState = container.get<IOnAirSelectStreamState>('IOnAirSelectStreamState');
    private dialogState: IGuideProgramDialogState = container.get<IGuideProgramDialogState>('IGuideProgramDialogState');
    private onAirState: IOnAirState = container.get<IOnAirState>('IOnAirState');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');

    public isPinned(channelId: apid.ChannelId): boolean {
        return this.onAirState.getPinnedChannelIds().includes(channelId);
    }

    /**
     * ピン留めの追加・解除 (視聴画面のチャンネル一覧と同じ設定を編集する)
     * @param channelId: apid.ChannelId
     */
    public togglePin(channelId: apid.ChannelId): void {
        const pinnedIds = [...this.onAirState.getPinnedChannelIds()];
        const index = pinnedIds.indexOf(channelId);
        if (index === -1) {
            pinnedIds.push(channelId);
        } else {
            pinnedIds.splice(index, 1);
        }

        this.setting.tmp.pinnedChannelIds = pinnedIds;
        this.setting.save();
    }

    public openGuideProgramDialog(schedule: apid.Schedule, e: Event): void {
        e.stopPropagation();

        const option: ProgramDialogOpenOption = {
            channel: schedule.channel,
            program: schedule.programs[0],
        };
        if (typeof this.reserveIndex[schedule.programs[0].id] !== 'undefined') {
            option.reserve = {
                type: this.reserveIndex[schedule.programs[0].id].type,
                reserveId: this.reserveIndex[schedule.programs[0].id].item.reserveId,
                ruleId: this.reserveIndex[schedule.programs[0].id].item.ruleId,
            };
        }

        this.dialogState.open(option);
    }

    /**
     * ストリーム選択ダイアログを開く
     * @param channelItem: apid.ScheduleChannleItem
     */
    public openStreamSelector(channelItem: apid.ScheduleChannleItem): void {
        this.streamSelectDialog.open(channelItem);
    }
}

export default toNative(OnAirCard);
</script>

<style lang="sass" scoped>
.channel-head
    min-width: 0
</style>
