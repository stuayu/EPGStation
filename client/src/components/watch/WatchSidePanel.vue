<template>
    <div class="watch-side-panel">
        <div class="content">
            <div v-for="tab in tabs" :key="tab" v-show="selectedTab === tab" class="content-item">
                <slot :name="tab"></slot>
            </div>
        </div>
        <div class="tabs">
            <div v-for="tab in tabs" :key="tab" class="tab" v-bind:class="{ selected: selectedTab === tab }" v-on:click="selectTab(tab)">
                <v-icon size="small">{{ getTabIcon(tab) }}</v-icon>
                <div class="label">{{ getTabName(tab) }}</div>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import { ISettingStorageModel, WatchSidePanelTab } from '@/model/storage/setting/ISettingStorageModel';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';

/**
 * 視聴画面の右パネル。下部のタブで中身を切り替える
 * 中身は名前付きスロット (program / channel / comment) で受け取る
 */
@Component({})
class WatchSidePanel extends Vue {
    /**
     * 表示するタブ。画面によって使う組み合わせが違う (録画視聴はチャンネル一覧を持たない)
     */
    @Prop({ required: true })
    public tabs!: WatchSidePanelTab[];

    public selectedTab: WatchSidePanelTab = 'program';

    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');

    public created(): void {
        // 前回選択したタブを復元する。この画面に無いタブが保存されていたら先頭のタブにする
        const savedTab = this.setting.getSavedValue().watchSidePanelTab;
        this.selectedTab = this.tabs.includes(savedTab) === true ? savedTab : this.tabs[0];
    }

    public selectTab(tab: WatchSidePanelTab): void {
        this.selectedTab = tab;

        this.setting.tmp.watchSidePanelTab = tab;
        this.setting.save();
    }

    public getTabName(tab: WatchSidePanelTab): string {
        switch (tab) {
            case 'program':
                return '番組情報';
            case 'channel':
                return 'チャンネル';
            case 'nextup':
                return '次の話';
            case 'comment':
                return 'コメント';
        }
    }

    public getTabIcon(tab: WatchSidePanelTab): string {
        switch (tab) {
            case 'program':
                return 'mdi-information-outline';
            case 'channel':
                return 'mdi-television-guide';
            case 'nextup':
                return 'mdi-playlist-play';
            case 'comment':
                return 'mdi-comment-text-outline';
        }
    }
}

export default toNative(WatchSidePanel);
</script>

<style lang="sass" scoped>
.watch-side-panel
    display: flex
    flex-direction: column
    flex: 1 1 auto
    min-height: 0

    .content
        flex: 1 1 auto
        min-height: 0
        display: flex

    .content-item
        flex: 1 1 auto
        min-width: 0
        min-height: 0
        overflow-y: auto

    .tabs
        display: flex
        flex-shrink: 0
        border-top: 1px solid var(--watch-border)

    .tab
        flex: 1 1 0
        display: flex
        flex-direction: column
        align-items: center
        justify-content: center
        gap: 2px
        padding: 8px 0
        cursor: pointer
        color: var(--watch-fg-dim)
        user-select: none

        &:hover
            color: var(--watch-fg)

        &.selected
            color: rgb(var(--v-theme-primary))

        .label
            font-size: 0.7rem
</style>
