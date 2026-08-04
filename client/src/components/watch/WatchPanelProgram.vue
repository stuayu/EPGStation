<template>
    <div class="watch-panel-program pa-3">
        <template v-if="info !== null">
            <div v-if="info.channelName" class="text-subtitle-2 channel">{{ info.channelName }}</div>
            <div v-if="info.time" class="text-caption time">{{ info.time }}</div>
            <div class="text-subtitle-1 font-weight-bold name">{{ info.name }}</div>
            <div v-if="info.description" class="text-body-2 description">{{ info.description }}</div>
            <div v-if="info.extended" class="text-body-2 extended">{{ info.extended }}</div>
            <div class="actions">
                <slot name="actions"></slot>
            </div>
        </template>
        <div v-else class="text-body-2 empty">番組情報がありません</div>
    </div>
</template>

<script lang="ts">
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';

export interface WatchProgramInfo {
    channelName?: string;
    time?: string;
    name: string;
    description?: string;
    extended?: string;
}

/**
 * 右パネルの「番組情報」タブの中身
 * ライブ視聴・録画視聴の双方から同じ形の情報を受け取って表示する
 */
@Component({})
class WatchPanelProgram extends Vue {
    @Prop({ required: false, default: null })
    public info!: WatchProgramInfo | null;
}

export default toNative(WatchPanelProgram);
</script>

<style lang="sass" scoped>
.watch-panel-program
    color: var(--watch-fg)

    .channel
        color: var(--watch-fg-muted)

    .time
        color: var(--watch-fg-dim)

    .name
        margin-top: 4px

    .description,
    .extended
        margin-top: 8px
        color: var(--watch-fg-muted)
        white-space: pre-wrap
        word-break: break-all

    .actions
        margin-top: 12px

    .empty
        color: var(--watch-fg-dim)
</style>
