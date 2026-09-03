<template>
    <div class="watch-layout" v-bind:class="{ 'is-panel-open': isPanelOpen === true, 'is-light': isLightTheme === true }">
        <WatchSideBar class="side-bar"></WatchSideBar>
        <div class="main">
            <div class="top">
                <!-- 狭い端末では左のアイコンナビを隠すため、代わりに戻る導線をここへ置く -->
                <v-btn icon variant="text" size="small" class="nav-back" title="戻る" v-on:click="goBack">
                    <v-icon>mdi-arrow-left</v-icon>
                </v-btn>
                <slot name="topBar"></slot>
                <v-btn
                    icon
                    variant="text"
                    size="small"
                    class="video-compact-toggle"
                    :title="isVideoCompact === true ? '映像を大きくする' : '映像を小さくしてパネルを広げる'"
                    v-on:click="toggleVideoCompact"
                >
                    <v-icon>{{ isVideoCompact === true ? 'mdi-arrow-expand-vertical' : 'mdi-arrow-collapse-vertical' }}</v-icon>
                </v-btn>
                <v-btn v-if="isPanelOpen === false" icon variant="text" size="small" class="panel-toggle" title="パネルを開く" v-on:click="togglePanel">
                    <v-icon>mdi-chevron-left</v-icon>
                </v-btn>
            </div>
            <div class="video-area" v-bind:class="{ 'is-compact': isVideoCompact === true }">
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
     * 映像を小さくしてパネルを広げるか。
     * 映像とパネルが縦に並ぶ狭い端末でのみ意味を持つ (横並びのときはパネル幅が固定なので効かせない)
     */
    public isVideoCompact: boolean = false;

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
        this.isVideoCompact = this.setting.getSavedValue().isWatchVideoCompact === true;

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

    /**
     * 映像の大きさを切り替える。
     * 狭い端末で SNS 投稿やチャンネル選択を使うとき、映像を小さくしてパネルへ高さを回すために使う
     */
    public toggleVideoCompact(): void {
        this.isVideoCompact = !this.isVideoCompact;

        this.setting.tmp.isWatchVideoCompact = this.isVideoCompact;
        this.setting.save();
    }

    /**
     * 直前の画面へ戻る。
     * 狭い端末では左のアイコンナビを隠すため、視聴画面から抜ける導線がここだけになる
     */
    public async goBack(): Promise<void> {
        if (window.history.length > 1) {
            this.$router.back();

            return;
        }

        await this.$router.push({ path: '/onair' }).catch(() => {});
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
        min-width: 0
        overflow: hidden

        // 伸ばすのは番組情報バーだけ。:first-child だと戻るボタンに当たり、
        // バー本体が押し出されて戻る・映像サイズのボタンが潰れる
        > .watch-top-bar
            flex: 1 1 auto
            min-width: 0

    .panel-toggle
        flex-shrink: 0
        margin-right: 4px
        color: var(--watch-fg-muted)

    // 戻る導線と映像サイズの切り替えは、映像とパネルが縦に並ぶ狭い端末でだけ使う
    .nav-back,
    .video-compact-toggle
        display: none
        flex-shrink: 0
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

    // 縦持ち。映像の下にパネルを積む
    @media screen and (max-width: 1024px) and (orientation: portrait)
        flex-direction: column
        overflow-y: auto

        .video-frame
            max-width: 100%

        .panel
            width: 100%
            flex: 1 1 auto
            min-height: 320px

    // スマートフォン相当。縦 568px では左のアイコンナビ (48px) とパネル見出し (48px) だけで
    // パネル本文の 4 割強が消えるため、視聴に不要なものを畳んで高さをパネルへ回す
    @media screen and (max-width: 720px) and (orientation: portrait)
        // 画面全体ではなくパネル本文の中だけをスクロールさせる。
        // 全体スクロールのままだとタブ行が画面外へ流れ、SNS 投稿やチャンネル選択の操作先が見えなくなる
        overflow: hidden

        .side-bar
            display: none

        // 上部 (バー + 映像) は実寸で固定し、余った高さはすべてパネルへ渡す。
        // flex: 1 1 auto のままだと映像を小さくした分が空白として残る
        .main
            flex: 0 0 auto

        .nav-back,
        .video-compact-toggle
            display: inline-flex

        // 放送局名は上部バーにも出るため、縦積みでは見出し行ごと省く
        .panel-header
            display: none

        // 映像は 16:9 の実寸で固定し、残りをすべてパネルへ渡す。
        // flex: 1 1 auto のままだとパネルの中身の高さに応じて映像が伸縮し、タブごとに配分が変わる。
        // データ放送のリモコンを開くと映像の下へ 300px ほど積み上がるため、
        // ここで上限を設けてはみ出す分は映像側でスクロールさせる (パネルのタブ行を画面外へ押し出さない)
        .video-area
            flex: 0 0 auto
            max-height: 60svh
            overflow-y: auto
            padding: 0 4px 4px

        .panel
            min-height: 0

        // 映像を小さくしてパネルへ高さを回す。
        // 幅を詰めて 16:9 を保つと 320px 端末で映像が 240px ほどになり、DPlayer のコントロールが重なって
        // 押せなくなる。幅は保ったまま枠の高さだけを下げ、映像は枠の中で letterbox させる
        .video-area.is-compact
            flex: 0 0 auto

            .video-frame
                max-width: 100%

            :deep(.video-container)
                height: 24svh

                &::before
                    display: none

        // データ放送のリモコンを開いている間は映像をさらに小さくする。
        // リモコンは映像の下に積まれるため、縮めないと映像自体がスクロールアウトして見えなくなる
        .video-area:has(.v-expansion-panel--active)
            :deep(.video-container)
                height: 20svh

                &::before
                    display: none

            // チャンネル切替ボタンは映像枠の縦中央 (top: 50%) に置かれている。
            // リモコンを開くと枠がリモコン込みで伸び、ボタンがリモコンの上に重なって色ボタンを塞ぐ
            :deep(.channel-switch)
                display: none

    // 横持ち。縦に積むと映像だけで画面が埋まりパネルの高さが 0 になるため、左右に分ける
    @media screen and (max-width: 1024px) and (orientation: landscape)
        flex-direction: row
        overflow: hidden

        .side-bar
            display: none

        .nav-back
            display: inline-flex

        // 映像を小さくする操作は縦持ち専用 (横持ちではパネル幅が固定で効かない)
        .video-compact-toggle
            display: none

        .main
            flex: 1 1 auto
            min-width: 0

        .video-area
            flex: 1 1 auto
            padding: 0 4px 4px

            &.is-compact .video-frame
                max-width: 100%

            &.is-compact :deep(.video-container)
                height: auto

                &::before
                    display: block

        .panel
            flex: 0 0 auto
            width: 44%
            max-width: 360px
            min-width: 240px

        .panel-header
            display: none
</style>
