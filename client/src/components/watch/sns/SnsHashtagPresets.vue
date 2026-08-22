<template>
    <div class="sns-hashtag-presets">
        <div class="text-caption mb-1">タップで追加</div>
        <div v-if="presets.length > 0" class="chips">
            <v-chip v-for="tag in presets" v-bind:key="tag" size="small" v-on:click="$emit('select', tag)">{{ tag }}</v-chip>
        </div>
        <div v-else class="text-caption text-medium-emphasis mb-2">プリセットはまだありません</div>

        <v-divider class="my-3"></v-divider>

        <div class="text-caption mb-1">プリセットの管理</div>
        <div v-for="(tag, i) in presets" v-bind:key="`manage-${tag}`" class="manage-row">
            <span class="tag-text">{{ tag }}</span>
            <v-btn icon size="x-small" variant="text" v-bind:disabled="i === 0" v-on:click="moveUp(i)" title="上へ">
                <v-icon size="16">mdi-arrow-up</v-icon>
            </v-btn>
            <v-btn icon size="x-small" variant="text" v-bind:disabled="i === presets.length - 1" v-on:click="moveDown(i)" title="下へ">
                <v-icon size="16">mdi-arrow-down</v-icon>
            </v-btn>
            <v-btn icon size="x-small" variant="text" color="error" v-on:click="removePreset(i)" title="削除">
                <v-icon size="16">mdi-delete-outline</v-icon>
            </v-btn>
        </div>

        <div class="add-row">
            <v-text-field v-model="newPresetInput" density="compact" hide-details label="新しいプリセット" v-on:keydown.enter="addPreset"></v-text-field>
            <v-btn size="small" variant="outlined" v-on:click="addPreset">追加</v-btn>
        </div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import ProgramHashtagUtil from '@/util/ProgramHashtagUtil';
import { Component, Vue, toNative } from 'vue-facing-decorator';

/**
 * ハッシュタグのプリセット管理 (localStorage の `snsSavedHashtags` を保持)。
 * 並べ替えは上下ボタンで行う (新規依存を足さないため vuedraggable 等は使わない)
 */
@Component({})
class SnsHashtagPresets extends Vue {
    public newPresetInput: string = '';

    private settingStorageModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');

    public get presets(): string[] {
        return this.settingStorageModel.tmp.snsSavedHashtags;
    }

    private setPresets(value: string[]): void {
        this.settingStorageModel.tmp.snsSavedHashtags = value;
        this.settingStorageModel.save();
    }

    public addPreset(): void {
        if (this.newPresetInput.trim() === '') return;

        const tags = ProgramHashtagUtil.normalizeHashtagInput(this.newPresetInput);
        this.newPresetInput = '';
        if (tags.length === 0) return;

        const existing = new Set(this.presets.map(t => t.toLowerCase()));
        const additions = tags.filter(t => existing.has(t.toLowerCase()) === false);
        if (additions.length === 0) return;

        this.setPresets([...this.presets, ...additions]);
    }

    public removePreset(index: number): void {
        const next = [...this.presets];
        next.splice(index, 1);
        this.setPresets(next);
    }

    public moveUp(index: number): void {
        if (index <= 0) return;
        const next = [...this.presets];
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        this.setPresets(next);
    }

    public moveDown(index: number): void {
        if (index >= this.presets.length - 1) return;
        const next = [...this.presets];
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
        this.setPresets(next);
    }
}

export default toNative(SnsHashtagPresets);
</script>

<style lang="sass" scoped>
.sns-hashtag-presets
    .chips
        display: flex
        flex-wrap: wrap
        gap: 4px
        margin-bottom: 8px

    .manage-row
        display: flex
        align-items: center
        gap: 2px
        margin-bottom: 2px

        .tag-text
            flex: 1 1 auto
            min-width: 0
            overflow: hidden
            text-overflow: ellipsis
            white-space: nowrap
            font-size: 0.85rem

    .add-row
        display: flex
        align-items: center
        gap: 4px
        margin-top: 8px

        > .v-input
            flex: 1 1 auto
            min-width: 0
</style>
