<template>
    <div class="watch-panel-program pa-3">
        <template v-if="info !== null">
            <template v-if="showHeading === true">
                <div v-if="info.channelName" class="text-subtitle-2 channel">{{ info.channelName }}</div>
                <div v-if="info.time" class="text-caption time">{{ info.time }}</div>
                <div class="text-subtitle-1 font-weight-bold name">{{ info.name }}</div>
            </template>
            <div v-if="info.seriesText" class="text-caption metadata">シリーズ: {{ info.seriesText }}</div>
            <div v-if="info.genreItems?.length" class="d-flex flex-wrap ga-1 metadata">
                <v-chip v-for="genre in info.genreItems" :key="genre" size="x-small" variant="tonal">{{ genre }}</v-chip>
            </div>
            <div v-if="info.durationText || info.videoText || info.audioText" class="text-caption metadata">
                <span v-if="info.durationText">放送時間: {{ info.durationText }}</span>
                <span v-if="info.videoText"> / 映像: {{ info.videoText }}</span>
                <span v-if="info.audioText"> / 音声: {{ info.audioText }}</span>
            </div>
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
    genreItems?: string[];
    durationText?: string;
    videoText?: string;
    audioText?: string;
    seriesText?: string;
}

/**
 * 右パネルの「番組情報」タブの中身
 * ライブ視聴・録画視聴の双方から同じ形の情報を受け取って表示する
 */
@Component({})
class WatchPanelProgram extends Vue {
    @Prop({ required: false, default: null })
    public info!: WatchProgramInfo | null;

    // 番組名・放送局・時刻を親の画面 (オフライン番組情報など) が既に表示している場合は false にして重複させない
    @Prop({ required: false, default: true })
    public showHeading!: boolean;
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

    .metadata
        margin-top: 6px
        color: var(--watch-fg-dim)

    .actions
        margin-top: 12px

    .empty
        color: var(--watch-fg-dim)
</style>
