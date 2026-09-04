<template>
    <div v-show="isVisible" class="time-line" v-bind:style="style" aria-hidden="true"></div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IGuideState from '@/model/state/guide/IGuideState';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';

@Component({})
class TimeScale extends Vue {
    get style(): any {
        return {
            top: `calc((${this.position} * (var(--timescale-height) / 60)) - 1px)`,
        };
    }

    get isVisible(): boolean {
        return this.position >= 0 && this.position < this.guideState.getTimesLength() * 60;
    }

    private guideState: IGuideState = container.get<IGuideState>('IGuideState');
    private timerId: ReturnType<typeof setTimeout> | null = null;
    private position: number = -100;

    public mounted(): void {
        // 次のタイマーをセット
        const loop = (): void => {
            this.timerId = setTimeout(() => {
                this.updatePosition();
                loop();
            }, this.getTimerNum());
        };
        loop();
    }

    private getTimerNum(): number {
        return (60 - new Date().getSeconds()) * 1000;
    }

    public unmounted(): void {
        if (this.timerId !== null) {
            clearTimeout(this.timerId);
        }
    }

    /**
     * 時刻線位置を更新する
     */
    private updatePosition(): void {
        const now = new Date().getTime();
        const startAt = this.guideState.getStartAt();
        this.position = Math.floor((now - startAt) / 1000 / 60);
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.updatePosition();
    }
}

export default toNative(TimeScale);
</script>

<style lang="sass" scoped>
.time-line
    position: absolute
    background-color: rgb(var(--v-theme-primary))
    width: 100%
    height: 2px
    z-index: 4
    pointer-events: none
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .45))

    &::before
        content: ""
        position: absolute
        left: -1px
        top: 50%
        width: 10px
        height: 10px
        border-radius: 50%
        background-color: rgb(var(--v-theme-primary))
        transform: translateY(-50%)
        box-shadow: 0 1px 3px rgba(0, 0, 0, .45)
</style>
