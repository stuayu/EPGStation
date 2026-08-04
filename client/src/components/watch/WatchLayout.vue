<template>
    <div class="watch-layout" v-bind:class="{ 'is-panel-open': isPanelOpen === true, 'is-light': isLightTheme === true }">
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
import INavigationState from '@/model/state/navigation/INavigationState';
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

    /**
     * ライトテーマか
     * 視聴画面の配色は CSS 変数で切り替えるため、ここではルート要素へクラスを付けるだけにする
     */
    get isLightTheme(): boolean {
        return this.$vuetify.theme.global.current.dark === false;
    }

    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private navigationState: INavigationState = container.get<INavigationState>('INavigationState');

    // 視聴画面へ入る前のグローバルナビゲーションの開閉状態 (画面を離れるときに戻す)
    private prevNavigationOpenState: boolean | null = null;

    public created(): void {
        // 開閉状態は次回以降の表示にも引き継ぐ
        this.isPanelOpen = this.setting.getSavedValue().isOpenWatchSidePanel !== false;

        // 左のアイコンナビゲーションが役割を兼ねるため、グローバルナビゲーションは畳んでおく
        this.prevNavigationOpenState = this.navigationState.openState;
        this.navigationState.openState = false;
    }

    public beforeUnmount(): void {
        this.navigationState.openState = this.prevNavigationOpenState;
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
    background: var(--watch-bg)
    color: var(--watch-fg-strong)

    // 視聴画面全体の配色。CSS 変数は scoped style の影響を受けず DOM を辿って継承されるため、
    // ここで一括定義すれば子コンポーネントの scoped style からもそのまま参照できる
    --watch-bg: #15100f
    --watch-fg: rgba(255, 255, 255, 0.9)
    --watch-fg-strong: #fff
    --watch-fg-muted: rgba(255, 255, 255, 0.72)
    --watch-fg-dim: rgba(255, 255, 255, 0.5)
    --watch-surface: rgba(255, 255, 255, 0.03)
    --watch-surface-subtle: rgba(255, 255, 255, 0.02)
    --watch-surface-item: rgba(255, 255, 255, 0.05)
    --watch-surface-hover: rgba(255, 255, 255, 0.1)
    --watch-surface-selected: rgba(255, 255, 255, 0.16)
    --watch-surface-chip: rgba(255, 255, 255, 0.08)
    --watch-border: rgba(255, 255, 255, 0.08)
    --watch-border-subtle: rgba(255, 255, 255, 0.06)

    // ライトモード。映像自体は黑帯ごと黑のままなので、周囲の UI だけを明るくする
    &.is-light
        --watch-bg: #f4f4f6
        --watch-fg: rgba(0, 0, 0, 0.87)
        --watch-fg-strong: rgba(0, 0, 0, 0.92)
        --watch-fg-muted: rgba(0, 0, 0, 0.66)
        --watch-fg-dim: rgba(0, 0, 0, 0.45)
        --watch-surface: #ffffff
        --watch-surface-subtle: rgba(0, 0, 0, 0.02)
        --watch-surface-item: rgba(0, 0, 0, 0.04)
        --watch-surface-hover: rgba(0, 0, 0, 0.08)
        --watch-surface-selected: rgba(0, 0, 0, 0.12)
        --watch-surface-chip: rgba(0, 0, 0, 0.06)
        --watch-border: rgba(0, 0, 0, 0.12)
        --watch-border-subtle: rgba(0, 0, 0, 0.08)

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
        color: var(--watch-fg-muted)

    .video-area
        flex: 1 1 auto
        min-height: 0
        display: flex
        align-items: center
        justify-content: center
        padding: 0 8px 8px

    // 16:9 を保ったまま、縦にも横にも収まる最大の大きさにする
    .video-frame
        position: relative
        width: 100%
        max-width: calc((100vh - 64px) * 16 / 9)

    .panel
        flex-shrink: 0
        display: flex
        flex-direction: column
        width: 360px
        background: var(--watch-surface)

    .panel-header
        display: flex
        align-items: center
        gap: 4px
        flex-shrink: 0
        height: 48px
        padding: 0 8px
        color: var(--watch-fg)

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
