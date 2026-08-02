<template>
    <div class="watch-panel-channels">
        <div class="tab-bar">
            <v-btn icon variant="text" size="x-small" v-on:click="scrollTab(-1)">
                <v-icon>mdi-chevron-left</v-icon>
            </v-btn>
            <div ref="tabList" class="tab-list">
                <div v-for="tab in tabs" :key="tab.id" class="tab" v-bind:class="{ selected: selectedTab === tab.id }" v-on:click="selectedTab = tab.id">
                    {{ tab.name }}
                </div>
            </div>
            <v-btn icon variant="text" size="x-small" v-on:click="scrollTab(1)">
                <v-icon>mdi-chevron-right</v-icon>
            </v-btn>
        </div>
        <div class="list">
            <div
                v-for="item in items"
                :key="item.display.channelId"
                class="item"
                v-bind:class="{ selected: item.display.channelId === currentChannelId }"
                v-on:click="onSelect(item)"
            >
                <div class="head">
                    <img v-if="item.display.logoSrc" :src="item.display.logoSrc" class="logo" />
                    <div class="channel-name">{{ item.display.channelName }}</div>
                    <v-btn
                        icon
                        variant="text"
                        size="x-small"
                        class="pin"
                        :title="isPinned(item.display.channelId) === true ? 'ピン留めを解除' : 'ピン留めする'"
                        v-on:click.stop="togglePin(item.display.channelId)"
                    >
                        <v-icon size="small">{{ isPinned(item.display.channelId) === true ? 'mdi-pin' : 'mdi-pin-outline' }}</v-icon>
                    </v-btn>
                </div>
                <div class="program-name">{{ item.display.name }}</div>
                <div class="program-time">{{ item.display.time }}</div>
                <template v-if="getNextProgramName(item) !== ''">
                    <div class="next-name">NEXT ▶ {{ getNextProgramName(item) }}</div>
                    <div class="program-time">{{ getNextProgramTime(item) }}</div>
                </template>
                <v-progress-linear :model-value="item.display.digestibility" height="2" color="primary" class="progress"></v-progress-linear>
            </div>
            <div v-if="items.length === 0" class="empty text-body-2">放送中の番組がありません</div>
        </div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IOnAirState, { OnAirDisplayData, OnAirTabItem } from '@/model/state/onair/IOnAirState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import DateUtil from '@/util/DateUtil';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../api';

/**
 * 右パネルの「チャンネル」タブの中身
 * 放送中の番組を放送波・地域ごとのタブで並べ、クリックでそのチャンネルの視聴へ切り替える
 */
@Component({})
class WatchPanelChannels extends Vue {
    /**
     * 視聴中の放送局 (一覧上で強調表示する)
     */
    @Prop({ required: false, default: null })
    public currentChannelId!: apid.ChannelId | null;

    public selectedTab: string = WatchPanelChannels.PINNED_TAB_ID;

    private onAirState: IOnAirState = container.get<IOnAirState>('IOnAirState');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private updateTimer: ReturnType<typeof setTimeout> | null = null;
    private digestibilityTimer: ReturnType<typeof setInterval> | null = null;

    private static readonly PINNED_TAB_ID = 'pinned';

    get tabs(): OnAirTabItem[] {
        return [
            {
                id: WatchPanelChannels.PINNED_TAB_ID,
                name: 'ピン留め',
            },
            ...this.onAirState.getTabs(),
        ];
    }

    get items(): OnAirDisplayData[] {
        if (this.selectedTab === WatchPanelChannels.PINNED_TAB_ID) {
            const pinnedIds = this.pinnedChannelIds;

            // ピン留めした順に並べる
            return pinnedIds
                .map(channelId => {
                    return this.onAirState.getSchedules().find(s => {
                        return s.display.channelId === channelId;
                    });
                })
                .filter((item): item is OnAirDisplayData => {
                    return typeof item !== 'undefined';
                });
        }

        return this.onAirState.getSchedules(this.selectedTab);
    }

    get pinnedChannelIds(): apid.ChannelId[] {
        return this.setting.getSavedValue().pinnedChannelIds ?? [];
    }

    public async created(): Promise<void> {
        await this.fetchData();
    }

    public beforeUnmount(): void {
        if (this.updateTimer !== null) {
            clearTimeout(this.updateTimer);
            this.updateTimer = null;
        }
        if (this.digestibilityTimer !== null) {
            clearInterval(this.digestibilityTimer);
            this.digestibilityTimer = null;
        }
    }

    /**
     * 放送中の番組を取得し、番組の切り替わりに合わせて次の取得を予約する
     */
    private async fetchData(): Promise<void> {
        await this.onAirState
            .fetchData({
                isHalfWidth: this.setting.getSavedValue().isHalfWidthDisplayed,
                includeNextProgram: true,
            })
            .catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: '番組情報取得に失敗',
                });
                console.error(err);
            });

        if (this.updateTimer !== null) {
            clearTimeout(this.updateTimer);
        }
        this.updateTimer = setTimeout(() => {
            void this.fetchData();
        }, this.onAirState.getUpdateTime());

        if (this.digestibilityTimer === null) {
            this.digestibilityTimer = setInterval(() => {
                this.onAirState.updateDigestibility();
            }, 10 * 1000);
        }
    }

    /**
     * 次の番組を返す (取得できていない場合は null)
     */
    public getNextProgram(item: OnAirDisplayData): apid.ScheduleProgramItem | null {
        return item.schedule.programs.length < 2 ? null : item.schedule.programs[1];
    }

    /**
     * 次の番組名を返す (取得できていない場合は空文字)
     */
    public getNextProgramName(item: OnAirDisplayData): string {
        return this.getNextProgram(item)?.name ?? '';
    }

    public getNextProgramTime(item: OnAirDisplayData): string {
        const next = this.getNextProgram(item);
        if (next === null) {
            return '';
        }

        const startAt = DateUtil.getJaDate(new Date(next.startAt));
        const endAt = DateUtil.getJaDate(new Date(next.endAt));

        return next.isDurationUndefined === true
            ? `${DateUtil.format(startAt, 'hh:mm')} ~ (終了未定)`
            : `${DateUtil.format(startAt, 'hh:mm')} ~ ${DateUtil.format(endAt, 'hh:mm')}`;
    }

    public isPinned(channelId: apid.ChannelId): boolean {
        return this.pinnedChannelIds.includes(channelId);
    }

    /**
     * ピン留めの追加・解除
     * @param channelId: apid.ChannelId
     */
    public togglePin(channelId: apid.ChannelId): void {
        const pinnedIds = [...this.pinnedChannelIds];
        const index = pinnedIds.indexOf(channelId);
        if (index === -1) {
            pinnedIds.push(channelId);
        } else {
            pinnedIds.splice(index, 1);
        }

        this.setting.tmp.pinnedChannelIds = pinnedIds;
        this.setting.save();
    }

    public onSelect(item: OnAirDisplayData): void {
        if (item.display.channelId === this.currentChannelId) {
            return;
        }

        this.$emit('select', item.display.channelId);
    }

    /**
     * タブの並びを横スクロールする
     * @param direction: number -1: 左, 1: 右
     */
    public scrollTab(direction: number): void {
        const tabList = this.$refs.tabList as HTMLElement | undefined;
        if (typeof tabList === 'undefined') {
            return;
        }

        tabList.scrollBy({ left: direction * tabList.clientWidth * 0.8, behavior: 'smooth' });
    }
}

export default toNative(WatchPanelChannels);
</script>

<style lang="sass" scoped>
.watch-panel-channels
    display: flex
    flex-direction: column
    height: 100%
    color: rgba(255, 255, 255, 0.9)

    .tab-bar
        display: flex
        align-items: center
        flex-shrink: 0
        padding: 4px

    .tab-list
        flex: 1 1 auto
        display: flex
        gap: 4px
        overflow-x: auto
        scrollbar-width: none

        &::-webkit-scrollbar
            display: none

    .tab
        flex-shrink: 0
        padding: 4px 10px
        border-radius: 999px
        font-size: 0.8rem
        white-space: nowrap
        cursor: pointer
        color: rgba(255, 255, 255, 0.6)
        user-select: none

        &:hover
            color: rgba(255, 255, 255, 0.9)

        &.selected
            color: rgb(var(--v-theme-primary))
            background: rgba(255, 255, 255, 0.08)

    .list
        flex: 1 1 auto
        min-height: 0
        overflow-y: auto
        padding: 4px 8px 8px

    .item
        position: relative
        margin-bottom: 8px
        padding: 8px 8px 10px
        border-radius: 6px
        background: rgba(255, 255, 255, 0.05)
        cursor: pointer

        &:hover
            background: rgba(255, 255, 255, 0.1)

        &.selected
            background: rgba(255, 255, 255, 0.16)

    .head
        display: flex
        align-items: center
        gap: 6px

        .logo
            height: 20px
            max-width: 48px
            object-fit: contain

        .channel-name
            flex: 1 1 auto
            min-width: 0
            font-size: 0.8rem
            font-weight: bold
            white-space: nowrap
            overflow: hidden
            text-overflow: ellipsis

        .pin
            flex-shrink: 0
            color: rgba(255, 255, 255, 0.5)

    .program-name
        margin-top: 4px
        font-size: 0.85rem
        display: -webkit-box
        -webkit-box-orient: vertical
        -webkit-line-clamp: 2
        overflow: hidden

    .next-name
        margin-top: 6px
        font-size: 0.75rem
        color: rgba(255, 255, 255, 0.6)
        white-space: nowrap
        overflow: hidden
        text-overflow: ellipsis

    .program-time
        font-size: 0.7rem
        color: rgba(255, 255, 255, 0.55)

    .progress
        position: absolute
        left: 0
        right: 0
        bottom: 0
        border-radius: 0 0 6px 6px

    .empty
        padding: 12px 4px
        color: rgba(255, 255, 255, 0.5)
</style>
