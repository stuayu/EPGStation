<template>
    <v-list-item class="playback-quality-item" role="option" :aria-selected="selected" @click="select">
        <template #prepend>
            <v-radio density="compact" :model-value="selected" :value="true" tabindex="-1" aria-label="選択中"></v-radio>
        </template>
        <!-- バッジは append (行の右端) ではなく本文側に置く。
             320px 幅では append に 56px 取られて本文が 102px しか残らず、「おまかせ (自 / 動)」のように名前が折り返る -->
        <div class="title-row">
            <v-list-item-title class="name">{{ label.name }}</v-list-item-title>
            <div v-if="label.badges.length > 0" class="badges">
                <v-chip v-for="badge in label.badges" :key="badge" size="x-small" color="primary" variant="tonal">{{ badge }}</v-chip>
            </div>
        </div>
        <v-list-item-subtitle class="summary">{{ label.summary }}</v-list-item-subtitle>
        <v-list-item-subtitle v-if="showDetail === true || isAuto === true" class="detail">
            <div>{{ label.detail }}</div>
            <div v-if="showDetail === true && modeNumber !== null" class="mode-number">mode: {{ modeNumber }}</div>
        </v-list-item-subtitle>
    </v-list-item>
</template>

<script lang="ts">
import * as apid from '../../../../../api';
import { getPlaybackLabel, PlaybackLabel } from '@/util/PlaybackLabelUtil';
import { Component, Emit, Prop, Vue, toNative } from 'vue-facing-decorator';

@Component({})
class PlaybackQualityItem extends Vue {
    @Prop({ required: true }) public profile!: apid.PlaybackProfile;
    @Prop({ required: true }) public selected!: boolean;
    @Prop({ default: false }) public showDetail!: boolean;
    @Prop({ required: false }) public source: apid.SourceCapabilities | undefined;
    @Prop({ required: false }) public recommended: apid.PlaybackOptions['recommended'] | undefined;
    // このプリセットが対象になっているコンテナ (config.yml の stream mode 番号を出すため)
    @Prop({ required: false }) public container: Exclude<apid.PlaybackContainer, 'normal'> | undefined;

    // 「おまかせ」行だけは詳細表示が OFF でも選択理由を出す
    get isAuto(): boolean {
        return (this.profile.role ?? this.profile.id) === 'auto';
    }

    get label(): PlaybackLabel {
        return getPlaybackLabel(this.profile, this.source, this.recommended);
    }

    // 詳しい表示のとき、このプリセットが config.yml の stream.* 何番目の設定に当たるかを出す
    get modeNumber(): number | null {
        if (typeof this.container === 'undefined') return null;
        const mode = this.profile.modes[this.container];
        return typeof mode === 'number' ? mode : null;
    }

    @Emit('select')
    public select(): string {
        return this.profile.id;
    }
}

export default toNative(PlaybackQualityItem);
</script>

<style scoped>
/* 狭い端末で本文へ幅を回すため、行の左右余白と radio の占有幅を詰める */
.v-list-item.playback-quality-item { min-height: 44px; padding-inline: 8px; }
.playback-quality-item :deep(.v-list-item__prepend) { margin-inline-end: 4px; }
.title-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.badges { display: flex; gap: 4px; flex-wrap: wrap; }
.name { white-space: normal; font-weight: 500; font-size: 0.95rem; line-height: 1.25; flex: 0 1 auto; }
.summary { white-space: normal; opacity: 0.8; }
.detail { white-space: normal; font-family: monospace; font-size: 0.75rem; opacity: 0.7; }
.mode-number { margin-top: 2px; }
</style>
