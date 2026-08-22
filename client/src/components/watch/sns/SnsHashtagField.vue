<template>
    <div class="sns-hashtag-field">
        <div v-if="modelValue.length > 0" class="chips">
            <v-chip v-for="tag in modelValue" v-bind:key="tag" size="small" closable v-on:click:close="removeTag(tag)">
                {{ tag }}
            </v-chip>
        </div>
        <div class="input-row">
            <v-text-field
                v-model="newTagInput"
                density="compact"
                hide-details
                label="ハッシュタグを追加"
                hint="スペース区切りで複数入力できます"
                v-on:keydown.enter="addInputAsTags"
            ></v-text-field>
            <v-btn icon size="small" variant="text" v-on:click="addInputAsTags" title="追加">
                <v-icon>mdi-plus</v-icon>
            </v-btn>
            <v-menu v-bind:close-on-content-click="false" location="bottom end">
                <template v-slot:activator="{ props }">
                    <v-btn icon size="small" variant="text" v-bind="props" title="プリセットから選ぶ">
                        <v-icon>mdi-tag-multiple-outline</v-icon>
                    </v-btn>
                </template>
                <v-card class="menu-card" max-width="320">
                    <v-card-text class="menu-card-body">
                        <SnsHashtagPresets v-on:select="onSelectPreset"></SnsHashtagPresets>
                    </v-card-text>
                </v-card>
            </v-menu>
        </div>
    </div>
</template>

<script lang="ts">
import ProgramHashtagUtil from '@/util/ProgramHashtagUtil';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';
import SnsHashtagPresets from './SnsHashtagPresets.vue';

/**
 * SNS 投稿パネルのハッシュタグ入力欄。チップ表示 + 手入力 + プリセット選択
 */
@Component({
    components: { SnsHashtagPresets },
})
class SnsHashtagField extends Vue {
    @Prop({ required: true })
    public modelValue!: string[];

    public newTagInput: string = '';

    public removeTag(tag: string): void {
        this.$emit(
            'update:modelValue',
            this.modelValue.filter(t => t !== tag),
        );
    }

    public addInputAsTags(): void {
        if (this.newTagInput.trim() === '') return;

        const tags = ProgramHashtagUtil.normalizeHashtagInput(this.newTagInput);
        this.newTagInput = '';
        this.addTags(tags);
    }

    public onSelectPreset(tag: string): void {
        this.addTags([tag]);
    }

    private addTags(tags: string[]): void {
        const existing = new Set(this.modelValue.map(t => t.toLowerCase()));
        const additions = tags.filter(t => existing.has(t.toLowerCase()) === false);
        if (additions.length === 0) return;

        this.$emit('update:modelValue', [...this.modelValue, ...additions]);
    }
}

export default toNative(SnsHashtagField);
</script>

<style lang="sass" scoped>
.sns-hashtag-field
    .chips
        display: flex
        flex-wrap: wrap
        gap: 4px
        margin-bottom: 6px

    .input-row
        display: flex
        align-items: center
        gap: 2px

        > .v-input
            flex: 1 1 auto
            min-width: 0
</style>
