<template>
    <div class="video-seek-bar">
        <div class="seek-slider">
            <v-slider
                v-bind:model-value="sliderValue"
                v-bind:min="0"
                v-bind:max="sliderMax"
                v-bind:step="1"
                v-bind:disabled="duration <= 0"
                color="primary"
                density="compact"
                hide-details
                v-on:start="onSeekStart"
                v-on:update:model-value="onSliderInput"
                v-on:end="onSeekEnd"
            ></v-slider>
        </div>
        <div class="seek-time text-caption">
            <span class="current-time">{{ currentTimeStr }}</span>
            <span class="separator">/</span>
            <span class="duration-time">{{ durationStr }}</span>
            <span class="total-minutes">(全 {{ totalMinutes }} 分)</span>
        </div>
    </div>
</template>

<script lang="ts">
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';

@Component({})
class VideoSeekBar extends Vue {
    @Prop({ required: true })
    public duration!: number; // 動画全体の長さ (秒)

    @Prop({ required: true })
    public currentTime!: number; // 現在の再生位置 (秒)

    // シークバーをドラッグ中はプレイヤー側の再生位置で上書きしない
    public isSeeking: boolean = false;
    public seekingValue: number = 0;

    get sliderMax(): number {
        return this.duration > 0 ? Math.floor(this.duration) : 1;
    }

    get sliderValue(): number {
        const value = this.isSeeking === true ? this.seekingValue : this.currentTime;

        return Math.min(Math.max(Math.floor(value), 0), this.sliderMax);
    }

    get currentTimeStr(): string {
        return VideoSeekBar.toTimeStr(this.isSeeking === true ? this.seekingValue : this.currentTime);
    }

    get durationStr(): string {
        return VideoSeekBar.toTimeStr(this.duration);
    }

    /**
     * 動画全体の分数 (切り上げ)
     */
    get totalMinutes(): number {
        return this.duration > 0 ? Math.ceil(this.duration / 60) : 0;
    }

    public onSeekStart(value: number): void {
        this.isSeeking = true;
        this.seekingValue = value;
    }

    public onSliderInput(value: number): void {
        this.seekingValue = value;
        if (this.isSeeking === false) {
            // クリックで一発指定された場合
            this.$emit('seek', value);
        }
    }

    public onSeekEnd(value: number): void {
        this.isSeeking = false;
        this.seekingValue = value;
        this.$emit('seek', value);
    }

    /**
     * 秒を h:mm:ss / m:ss 形式の文字列に変換する
     * @param time: number 秒
     * @return string
     */
    private static toTimeStr(time: number): string {
        if (isFinite(time) === false || time <= 0) {
            return '0:00';
        }

        const total = Math.floor(time);
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const seconds = total % 60;
        const pad = (value: number): string => (value < 10 ? `0${value}` : `${value}`);

        return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
    }
}

export default toNative(VideoSeekBar);
</script>

<style lang="sass" scoped>
.video-seek-bar
    display: flex
    align-items: center
    gap: 12px
    padding: 4px 12px

    .seek-slider
        flex-grow: 1

    .seek-time
        white-space: nowrap
        display: flex
        gap: 4px
        align-items: center

        .total-minutes
            opacity: 0.7
</style>
