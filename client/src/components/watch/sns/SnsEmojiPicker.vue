<template>
    <div class="sns-emoji-picker">
        <v-text-field
            ref="searchField"
            v-model="searchText"
            density="compact"
            hide-details
            clearable
            prepend-inner-icon="mdi-magnify"
            label="絵文字を検索"
            hint="名前・エイリアス・カテゴリで絞り込めます"
        ></v-text-field>

        <v-autocomplete
            v-if="categories.length > 1"
            v-model="selectedCategory"
            v-bind:items="categoryItems"
            density="compact"
            hide-details
            clearable
            label="カテゴリで絞り込み"
            class="category-select"
        ></v-autocomplete>

        <div v-if="isSearching === false && recentEmojis.length > 0" class="recent-section">
            <div class="section-label text-caption">よく使う</div>
            <div class="grid">
                <button
                    v-for="e in recentEmojis"
                    v-bind:key="`recent-${e.name}`"
                    type="button"
                    class="emoji-cell"
                    v-bind:title="`:${e.name}:`"
                    v-on:click="onSelect(e)"
                >
                    <img v-bind:src="e.url" v-bind:alt="e.name" loading="lazy" />
                </button>
            </div>
        </div>

        <div v-if="isSearching === false" class="section-label text-caption">
            {{ recentEmojis.length > 0 ? 'すべて' : '絵文字' }} ({{ filteredEmojis.length }} 件。検索してください)
        </div>

        <div class="grid">
            <button
                v-for="e in displayedEmojis"
                v-bind:key="e.name"
                type="button"
                class="emoji-cell"
                v-bind:title="`:${e.name}:`"
                v-on:click="onSelect(e)"
            >
                <img v-bind:src="e.url" v-bind:alt="e.name" loading="lazy" />
            </button>
        </div>

        <div v-if="filteredEmojis.length === 0" class="text-caption empty">該当する絵文字がありません</div>
        <div v-else-if="isTruncated === true" class="text-caption truncated-hint">
            他 {{ candidateEmojis.length - displayedEmojis.length }} 件。{{ isSearching === true ? 'さらに絞り込んでください' : '検索してください' }}
        </div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import VuetifyUtil from '@/util/VuetifyUtil';
import type { ComponentPublicInstance } from 'vue';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../../api';

/**
 * Misskey カスタム絵文字の検索付きピッカー (表示のみ)。
 * 数千件・数百カテゴリ返るインスタンスがあるため、**検索を主役にする**:
 * - カテゴリは chip の羅列ではなく `v-autocomplete` (検索付きドロップダウン) に畳む
 * - 検索前は「よく使う」(localStorage に保持する最近使った絵文字、新しい順・最大 30 件) + 先頭 N 件だけを出す
 * - 検索中も上限件数で打ち切る (仮想スクロールの代わりに件数制限で狭い端末でも確実に動く形にしている)
 * 選択時は `select` イベントで絵文字オブジェクトを渡すだけで、本文への挿入やリアクション送信は呼び出し側が行う。
 * 「よく使う」への記録はこのコンポーネント内で完結させる (呼び出し側に手間をかけさせない)
 */
@Component({})
class SnsEmojiPicker extends Vue {
    @Prop({ required: true })
    public emojis!: apid.SnsMisskeyEmoji[];

    // 検索前に表示する件数 (「よく使う」とは別枠)
    private static readonly PREVIEW_LIMIT = 40;
    // 検索中に表示する上限件数
    private static readonly DISPLAY_LIMIT = 200;
    // 「よく使う」として保持する最大件数
    private static readonly RECENT_LIMIT = 30;

    public searchText: string = '';
    public selectedCategory: string | null = null;

    private settingStorageModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');

    public mounted(): void {
        void VuetifyUtil.focusTextFiled(this.$refs.searchField as ComponentPublicInstance).catch(() => {
            // フォーカスに失敗しても検索自体は使えるため無視する
        });
    }

    public get isSearching(): boolean {
        return this.searchText.trim() !== '';
    }

    public get categories(): string[] {
        const set = new Set<string>();
        for (const e of this.emojis) {
            if (e.category !== null && e.category !== '') {
                set.add(e.category);
            }
        }

        return [...set].sort((a, b) => a.localeCompare(b, 'ja'));
    }

    public get categoryItems(): { title: string; value: string }[] {
        return this.categories.map(c => ({ title: c, value: c }));
    }

    /**
     * 直近に使った絵文字 (新しい順)。設定に保持している名前を現在の絵文字一覧と突き合わせる
     * (インスタンス切り替えなどで一覧から消えている名前は自然に除外される)
     */
    public get recentEmojis(): apid.SnsMisskeyEmoji[] {
        const byName = new Map(this.emojis.map(e => [e.name, e]));
        const result: apid.SnsMisskeyEmoji[] = [];
        for (const name of this.settingStorageModel.tmp.snsRecentEmojiNames) {
            const emoji = byName.get(name);
            if (typeof emoji !== 'undefined') {
                result.push(emoji);
            }
        }

        return result.slice(0, SnsEmojiPicker.RECENT_LIMIT);
    }

    public get filteredEmojis(): apid.SnsMisskeyEmoji[] {
        const keyword = this.searchText.trim().toLowerCase();

        return this.emojis.filter(e => {
            if (this.selectedCategory !== null && e.category !== this.selectedCategory) {
                return false;
            }
            if (keyword === '') {
                return true;
            }

            return (
                e.name.toLowerCase().includes(keyword) === true ||
                e.aliases.some(a => a.toLowerCase().includes(keyword) === true) === true ||
                (e.category ?? '').toLowerCase().includes(keyword) === true
            );
        });
    }

    /**
     * `displayedEmojis` の元になる候補一覧。検索前は「よく使う」に既に出ている絵文字を除く
     * (メイングリッドと二重表示しないため)。`isTruncated` の判定もこれを基準にする
     * (除いた分を「切り捨てた」と誤認して「他 N 件」の案内が過大にならないようにする)
     */
    public get candidateEmojis(): apid.SnsMisskeyEmoji[] {
        if (this.isSearching === true) {
            return this.filteredEmojis;
        }

        const recentNames = new Set(this.recentEmojis.map(e => e.name));

        return this.filteredEmojis.filter(e => recentNames.has(e.name) === false);
    }

    public get displayedEmojis(): apid.SnsMisskeyEmoji[] {
        const limit = this.isSearching === true ? SnsEmojiPicker.DISPLAY_LIMIT : SnsEmojiPicker.PREVIEW_LIMIT;

        return this.candidateEmojis.slice(0, limit);
    }

    public get isTruncated(): boolean {
        return this.candidateEmojis.length > this.displayedEmojis.length;
    }

    public onSelect(e: apid.SnsMisskeyEmoji): void {
        this.recordRecentUsage(e.name);
        this.$emit('select', e);
    }

    /**
     * 選んだ絵文字を「よく使う」の先頭へ積む (重複は除いてから積み直す。上限を超えた分は切り捨てる)
     * @param name: string
     */
    private recordRecentUsage(name: string): void {
        const names = [name, ...this.settingStorageModel.tmp.snsRecentEmojiNames.filter(n => n !== name)].slice(
            0,
            SnsEmojiPicker.RECENT_LIMIT,
        );
        this.settingStorageModel.tmp.snsRecentEmojiNames = names;
        this.settingStorageModel.save();
    }
}

export default toNative(SnsEmojiPicker);
</script>

<style lang="sass" scoped>
.sns-emoji-picker
    display: flex
    flex-direction: column
    min-height: 0

    .category-select
        margin-top: 8px

    .section-label
        margin-top: 10px
        color: var(--watch-fg-dim)

    .recent-section
        display: flex
        flex-direction: column

    .grid
        display: grid
        grid-template-columns: repeat(auto-fill, minmax(36px, 1fr))
        gap: 4px
        margin-top: 6px
        overflow-y: auto

    .emoji-cell
        display: flex
        align-items: center
        justify-content: center
        width: 100%
        aspect-ratio: 1 / 1
        border-radius: 4px
        border: none
        background: transparent
        cursor: pointer

        &:hover,
        &:focus-visible
            background: rgba(128, 128, 128, 0.2)

        img
            max-width: 28px
            max-height: 28px
            object-fit: contain

    .empty,
    .truncated-hint
        color: var(--watch-fg-dim)
        margin-top: 8px
        text-align: center
</style>
