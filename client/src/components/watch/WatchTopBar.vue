<template>
    <div class="watch-top-bar">
        <div class="channel">
            <img v-if="logoSrc !== null && hasLogoError === false" :src="logoSrc" class="logo" v-on:error="onLogoError" />
            <div v-else-if="channelName !== null" class="logo-text">{{ channelName }}</div>
        </div>
        <div class="program">
            <div class="name">{{ programName }}</div>
        </div>
        <div class="time">{{ timeText }}</div>
        <div v-if="showClock === true" class="clock">{{ clockText }}</div>
        <div class="menu">
            <slot name="menu"></slot>
        </div>
    </div>
</template>

<script lang="ts">
import DateUtil from '@/util/DateUtil';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';

/**
 * 視聴画面の上部に置く放送局 + 番組情報のバー
 */
@Component({})
class WatchTopBar extends Vue {
    @Prop({ required: false, default: null })
    public logoSrc!: string | null;

    @Prop({ required: false, default: null })
    public channelName!: string | null;

    @Prop({ required: false, default: '' })
    public programName!: string;

    /**
     * 「05:57 ～ 06:07」のような放送時間の表記
     */
    @Prop({ required: false, default: '' })
    public timeText!: string;

    /**
     * 右端に時計を出すか (ライブ視聴では現在時刻、録画では出さない)
     */
    @Prop({ required: false, default: false })
    public showClock!: boolean;

    public clockText: string = '';

    /**
     * ロゴを持たない放送局では画像の取得に失敗するため、その場合は放送局名の表示へ切り替える
     */
    public hasLogoError: boolean = false;

    private clockTimer: ReturnType<typeof setInterval> | null = null;

    public onLogoError(): void {
        this.hasLogoError = true;
    }

    @Watch('logoSrc')
    public onChangeLogoSrc(): void {
        this.hasLogoError = false;
    }

    public created(): void {
        if (this.showClock === false) {
            return;
        }

        this.updateClock();
        this.clockTimer = setInterval(() => {
            this.updateClock();
        }, 1000);
    }

    public beforeUnmount(): void {
        if (this.clockTimer !== null) {
            clearInterval(this.clockTimer);
            this.clockTimer = null;
        }
    }

    private updateClock(): void {
        this.clockText = DateUtil.format(DateUtil.getJaDate(new Date()), 'yyyy/MM/dd hh:mm:ss');
    }
}

export default toNative(WatchTopBar);
</script>

<style lang="sass" scoped>
.watch-top-bar
    display: flex
    align-items: center
    gap: 12px
    flex-shrink: 0
    height: 48px
    padding: 0 12px
    overflow: hidden
    color: var(--watch-fg-strong)

    .channel
        flex-shrink: 0
        display: flex
        align-items: center

        .logo
            height: 28px
            max-width: 72px
            object-fit: contain

        .logo-text
            font-size: 0.8rem
            font-weight: bold
            white-space: nowrap

    .program
        flex: 1 1 auto
        min-width: 0

        .name
            font-size: 1rem
            font-weight: bold
            white-space: nowrap
            overflow: hidden
            text-overflow: ellipsis

    .time,
    .clock
        flex-shrink: 0
        font-size: 0.85rem
        color: var(--watch-fg-muted)

    .menu
        flex-shrink: 0
        display: flex
        align-items: center

    @media screen and (max-width: 720px)
        .time,
        .clock
            display: none
</style>
