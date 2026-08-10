<template>
    <div v-if="searchResult !== null" class="search-result mx-auto my-8">
        <div class="d-flex align-center justify-end">
            <v-btn icon variant="text" v-on:click="jumpResultOption">
                <v-icon>mdi-link</v-icon>
            </v-btn>
            <div class="ml-1">{{ searchResult.length }} 件ヒット</div>
        </div>
        <SearchResultCard v-for="program in pagedResult" v-bind:key="program.program.id" :program="program"></SearchResultCard>
        <div v-if="totalPages > 1" class="mt-4">
            <div class="text-center text-caption text-grey mb-1">
                {{ offset + 1 }}–{{ Math.min(offset + pageSize, searchResult.length) }} / {{ searchResult.length }}
            </div>
            <v-pagination
                v-model="page"
                :circle="false"
                :length="totalPages"
                :total-visible="7"
                show-first-last-page
                density="comfortable"
                v-on:update:model-value="onMovePage"
            ></v-pagination>
        </div>
    </div>
</template>

<script lang="ts">
import SearchResultCard from '@/components/search/SearchResultCard.vue';
import container from '@/model/ModelContainer';
import ISearchState, { SearchResultItem } from '@/model/state/search/ISearchState';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';

@Component({
    components: {
        SearchResultCard,
    },
})
class SearchResult extends Vue {
    public searchState: ISearchState = container.get<ISearchState>('ISearchState');

    // 検索結果は全件クライアントに載っているため、表示だけをページ単位に区切る
    public page: number = 1;

    get pageSize(): number {
        return SearchResult.PAGE_SIZE;
    }

    get searchResult(): SearchResultItem[] | null {
        return this.searchState.getSearchResult();
    }

    get totalPages(): number {
        const length = this.searchResult === null ? 0 : this.searchResult.length;

        return length === 0 ? 1 : Math.ceil(length / SearchResult.PAGE_SIZE);
    }

    get offset(): number {
        return (this.page - 1) * SearchResult.PAGE_SIZE;
    }

    /**
     * 現在のページに表示する検索結果
     */
    get pagedResult(): SearchResultItem[] {
        if (this.searchResult === null) {
            return [];
        }

        return this.searchResult.slice(this.offset, this.offset + SearchResult.PAGE_SIZE);
    }

    /**
     * 検索し直したら 1 ページ目へ戻す
     */
    @Watch('searchResult')
    public onSearchResultChanged(): void {
        this.page = 1;
    }

    /**
     * ページ移動時に結果の先頭までスクロールする (下端のページャを押したまま次ページの途中を見せないため)
     */
    public onMovePage(): void {
        this.$el.scrollIntoView({ block: 'start' });
    }

    public jumpResultOption(): void {
        this.$emit('ruleOption');
    }
}

namespace SearchResult {
    export const PAGE_SIZE = 50;
}

export default toNative(SearchResult);
</script>

<style lang="sass" scoped>
.search-result
    width: 100%
    max-width: 800px
</style>
