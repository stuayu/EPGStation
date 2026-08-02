<template>
    <div id="app">
        <AppContent></AppContent>
    </div>
</template>

<script>
import AppContent from '@/views/AppContent.vue';

export default {
    name: 'app',
    components: {
        AppContent,
    },
};
</script>

<style lang="sass">
/**
  * ページ移動アニメーション
  */
.page-enter-active, .page-leave-active
    transition: opacity .5s

.page-enter, .page-leave-to
    opacity: 0
</style>

<style lang="sass">
html
    overflow: auto !important
    -webkit-overflow-scrolling: touch

    &.freeze
        -webkit-overflow-scrolling: auto

/**
 * dialog の設定
 */
.v-dialog__content.v-dialog__content--active
    .v-dialog.v-dialog--active
        margin-left: 0
        margin-right: 0
        max-height: calc( 100% -  120px)

.menu-button
    > .v-btn__content, > .v-icon
        pointer-events: none
</style>

<style lang="sass">
/**
 * iOS でスクロール時に表示が崩れるため
 * アドレスバーを常時最大サイズで表示させる
 */
html.fix-address-bar
    height: 100%
    overflow: hidden !important

html.fix-address-bar2
    height: 100%
    overflow: auto !important

html.fix-address-bar, html.fix-address-bar2
    body, #app
        height: 100%

    #app
        .v-application--wrap
            height: 100%
            min-height: 100%
</style>

<style lang="sass">
/**
  * メニュー背景
  */
.menu-background
    position: fixed
    top: 0
    left: 0
    width: 100%
    height: 100vh
    z-index: 7 // vuetify アップデート毎に確認が必要
</style>

<style lang="sass">
/**
 * 複数選択時の色
 */
.selected-color
    color: white !important
    background-color: #4285f4 !important
</style>

<style lang="sass">
/**
 * データ放送 (BML) ブラウザのコンテナ。
 * DataBroadcastingManager (client/src/util/DataBroadcastingManager.ts) が DPlayer の
 * dplayer-video-wrap の中に動的に挿入する (映像より下のレイヤーに置き、表示状態になると
 * 映像の DOM 要素をこの中の video plane へ物理的に移動する)。
 * データ放送は 960x540 か 720x480 の固定サイズなので、transform: scale() でレスポンシブにする
 * (KonomiTV の .dplayer-bml-browser 定義を踏襲)
 */
.dplayer-video-wrap
    .dplayer-bml-browser
        display: block
        position: absolute
        width: var(--bml-browser-width, 960px)
        height: var(--bml-browser-height, 540px)
        // 背景色は指定しない。BML 文書側が背景を持つため、ここで塗ると
        // 映像に重ねて一部だけ表示するコンテンツで透過すべき領域が潰れる
        color: #000
        overflow: hidden
        transform-origin: center
        transform: scale(var(--bml-browser-scale-factor-width, 1), var(--bml-browser-scale-factor-height, 1))
        aspect-ratio: 16 / 9
</style>
