<template>
    <div class="watch-layout" v-bind:class="{ 'is-panel-open': isPanelOpen === true }">
        <WatchSideBar class="side-bar"></WatchSideBar>
        <div class="main">
            <div class="top">
                <slot name="topBar"></slot>
                <v-btn v-if="isPanelOpen === false" icon variant="text" size="small" class="panel-toggle" title="パネルを開く" v-on:click="togglePanel">
                    <v-icon>mdi-chevron-left</v-icon>
                </v-btn>
            </div>
            <div class="video-area">
                <div class="video-frame">
                    <slot></slot>
                </div>
            </div>
        </div>
        <div v-if="isPanelOpen === true" class="panel">
            <div class="panel-header">
                <v-btn icon variant="text" size="small" title="パネルを閉じる" v-on:click="togglePanel">
                    <v-icon>mdi-chevron-right</v-icon>
                </v-btn>
                <div class="panel-title">{{ panelTitle }}</div>
            </div>
            <div class="panel-body">
                <slot name="panel"></slot>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import WatchSideBar from '@/components/watch/WatchSideBar.vue';
import container from '@/model/ModelContainer';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';

/**
 * 視聴画面 (ライブ / 録画) の共通レイアウト
 * 左にアイコンナビゲーション、中央に映像、右に情報パネルを置く
 */
@Component({
    components: {
        WatchSideBar,
    },
})
class WatchLayout extends Vue {
    /**
     * パネル上部に出す見出し (放送局名など)
     */
    @Prop({ required: false, default: '' })
    public panelTitle!: string;

    public isPanelOpen: boolean = true;

    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');

    public created(): void {
        // 開閉状態は次回以降の表示にも引き継ぐ
        this.isPanelOpen = this.setting.getSavedValue().isOpenWatchSidePanel !== false;
    }

    public togglePanel(): void {
        this.isPanelOpen = !this.isPanelOpen;

        this.setting.tmp.isOpenWatchSidePanel = this.isPanelOpen;
        this.setting.save();
    }
}

export default toNative(WatchLayout);
</script>

<style lang="sass" scoped>
.watch-layout
    position: fixed
    top: 0
    right: 0
    bottom: 0
    left: 0
    z-index: 4
    display: flex
    background: #15100f
    color: #fff

    .main
        flex: 1 1 auto
        min-width: 0
        display: flex
        flex-direction: column

    .top
        display: flex
        align-items: center

        > :first-child
            flex: 1 1 auto
            min-width: 0

    .panel-toggle
        flex-shrink: 0
        margin-right: 4px
        color: rgba(255, 255, 255, 0.7)

    .video-area
        flex: 1 1 auto
        min-height: 0
        display: flex
        align-items: center
        justify-content: center
        padding: 0 8px 8px

    // 16:9 を保ったまま、縦にも横にも収まる最大の大きさにする
    .video-frame
        width: 100%
        max-width: calc((100vh - 64px) * 16 / 9)

    .panel
        flex-shrink: 0
        display: flex
        flex-direction: column
        width: 360px
        background: rgba(255, 255, 255, 0.03)

    .panel-header
        display: flex
        align-items: center
        gap: 4px
        flex-shrink: 0
        height: 48px
        padding: 0 8px
        color: rgba(255, 255, 255, 0.85)

        .panel-title
            font-size: 0.9rem
            font-weight: bold
            white-space: nowrap
            overflow: hidden
            text-overflow: ellipsis

    .panel-body
        flex: 1 1 auto
        min-height: 0
        display: flex
        flex-direction: column

    @media screen and (max-width: 1024px)
        flex-direction: column
        overflow-y: auto

        .video-frame
            max-width: 100%

        .panel
            width: 100%
            flex: 1 1 auto
            min-height: 320px
</style>
