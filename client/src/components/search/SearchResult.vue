<template>
    <div v-if="searchResult !== null" class="search-result mx-auto my-8">
        <div class="d-flex align-center justify-end">
            <v-btn icon v-on:click="jumpResultOption">
                <v-icon>mdi-link</v-icon>
            </v-btn>
            <div class="ml-1">{{ searchResult.length }} 件ヒット</div>
        </div>
        <SearchResultCard v-for="program in searchResult" v-bind:key="program.program.id" :program="program"></SearchResultCard>
    </div>
</template>

<script lang="ts">
import SearchResultCard from '@/components/search/SearchResultCard.vue';
import container from '@/model/ModelContainer';
import ISearchState, { SearchResultItem } from '@/model/state/search/ISearchState';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';

@Component({
    components: {
        SearchResultCard,
    },
})
class SearchResult extends Vue {
    public searchState: ISearchState = container.get<ISearchState>('ISearchState');


    get searchResult(): SearchResultItem[] | null {
        return this.searchState.getSearchResult();
    }

    public jumpResultOption(): void {
        this.$emit('ruleOption');
    }
}

export default toNative(SearchResult);
</script>

<style lang="sass" scoped>
.search-result
    width: 100%
    max-width: 800px
</style>
