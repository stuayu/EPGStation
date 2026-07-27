<template>
    <div>
        <v-menu v-model="isOpen" location="bottom start" :close-on-content-click="false">
            <template v-slot:activator="{ props }">
                <v-btn icon variant="text" v-bind="props">
                    <v-icon>mdi-magnify</v-icon>
                </v-btn>
            </template>
            <v-card width="420">
                <div class="recorded-search pa-4">
                    <div class="d-flex align-center">
                        <v-text-field
                            v-model="searchState.keyword"
                            label="キーワード"
                            clearable
                            v-on:keydown.enter="onSearch()"
                            ref="keyword"
                            class="flex-grow-1"
                        ></v-text-field>
                        <v-tooltip v-if="isAdvancedSearchEnabled === true" location="bottom" max-width="320">
                            <template v-slot:activator="{ props: tooltipProps }">
                                <v-icon v-bind="tooltipProps" class="ml-1 mb-4">mdi-help-circle-outline</v-icon>
                            </template>
                            <div>
                                高度な検索構文が使えます。
                                <br />・スペース区切りで AND 検索
                                <br />・OR / | で OR 検索
                                <br />・- または ! で除外
                                <br />・"フレーズ" で完全一致
                                <br />・title: desc: ext: tag: ch: でフィールド指定
                            </div>
                        </v-tooltip>
                    </div>
                    <v-autocomplete
                        v-model="searchState.ruleId"
                        :disabled="isNoRule === true"
                        :loading="loading"
                        :items="searchState.ruleItems"
                        v-model:search="search"
                        item-title="keyword"
                        item-value="id"
                        cache-items
                        flat
                        hide-no-data
                        hide-details
                        clearable
                        label="ルール"
                        class="pb-2"
                    ></v-autocomplete>
                    <v-select v-model="searchState.channelId" :items="searchState.channelItems" label="放送局" clearable></v-select>
                    <v-select v-model="searchState.genre" :items="searchState.genreItems" label="ジャンル" clearable></v-select>
                    <v-select
                        v-if="isAdvancedSearchEnabled === true"
                        v-model="searchState.tagId"
                        :items="searchState.tagItems"
                        label="タグ (子孫タグも含めて絞り込み)"
                        clearable
                    ></v-select>
                    <div class="check-boxes">
                        <v-checkbox v-model="searchState.hasOriginalFile" label="元ファイルを含む" class="mt-2"></v-checkbox>
                        <v-checkbox v-model="isNoRule" label="手動録画のみ" class="mt-2"></v-checkbox>
                    </div>

                    <template v-if="isAdvancedSearchEnabled === true">
                        <v-divider class="my-2"></v-divider>
                        <div class="d-flex align-center mb-1">
                            <span class="text-caption">タグ管理</span>
                            <v-spacer></v-spacer>
                            <v-btn size="small" variant="text" @click="isTagManageOpen = true">タグを管理</v-btn>
                        </div>

                        <v-divider class="my-2"></v-divider>
                        <div class="text-caption mb-1">保存検索</div>
                        <div class="d-flex align-center ga-1 mb-2">
                            <v-text-field v-model="newSavedSearchName" label="この条件を保存" density="compact" hide-details clearable></v-text-field>
                            <v-btn size="small" variant="outlined" :disabled="!newSavedSearchName" :loading="savingSearch" @click="saveCurrentSearch"
                                >保存</v-btn
                            >
                        </div>
                        <div v-if="savedSearches.length === 0" class="text-caption text-medium-emphasis mb-2">保存済みの検索はありません</div>
                        <v-list v-else density="compact" class="saved-search-list">
                            <v-list-item v-for="s in savedSearches" :key="s.id">
                                <template v-if="renamingId === s.id">
                                    <div class="d-flex align-center ga-1">
                                        <v-text-field v-model="renameValue" density="compact" hide-details></v-text-field>
                                        <v-btn size="small" variant="text" color="primary" @click="commitRename(s)">OK</v-btn>
                                    </div>
                                </template>
                                <template v-else>
                                    <div class="d-flex align-center">
                                        <v-btn size="small" variant="text" v-on:click="applySavedSearch(s)">{{ s.name }}</v-btn>
                                        <v-spacer></v-spacer>
                                        <v-btn size="small" icon variant="text" v-on:click="togglePin(s)">
                                            <v-icon size="small">{{ s.isPinned === true ? 'mdi-pin' : 'mdi-pin-outline' }}</v-icon>
                                        </v-btn>
                                        <v-btn size="small" icon variant="text" v-on:click="startRename(s)"><v-icon size="small">mdi-pencil</v-icon></v-btn>
                                        <v-btn size="small" icon variant="text" color="error" v-on:click="deleteSavedSearch(s)"
                                            ><v-icon size="small">mdi-delete</v-icon></v-btn
                                        >
                                    </div>
                                </template>
                            </v-list-item>
                        </v-list>
                    </template>
                </div>
                <v-divider></v-divider>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn v-on:click="onCancel" variant="text" color="error">閉じる</v-btn>
                    <v-btn v-on:click="onSearch" variant="text" color="primary">検索</v-btn>
                </v-card-actions>
            </v-card>
        </v-menu>
        <div v-if="isOpen === true" class="menu-background" v-on:click="onClickMenuBackground"></div>
        <TagManageDialog v-model:isOpen="isTagManageOpen"></TagManageDialog>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import ISavedSearchApiModel from '@/model/api/savedSearch/ISavedSearchApiModel';
import IRecordedSearchState from '@/model/state/recorded/search/IRecordedSearchState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import { isFeatureEnabled } from '@/util/FeatureFlags';
import Util from '@/util/Util';
import VuetifyUtil from '@/util/VuetifyUtil';
import type { ComponentPublicInstance } from 'vue';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../api';
import TagManageDialog from './TagManageDialog.vue';

@Component({ components: { TagManageDialog } })
class RecordedSearchMenu extends Vue {
    public loading: boolean = false;
    public search: string | undefined;
    public isNoRule: boolean = false;
    public isTagManageOpen: boolean = false;

    public savedSearches: apid.SavedSearchItem[] = [];
    public newSavedSearchName: string = '';
    public savingSearch: boolean = false;
    public renamingId: apid.SavedSearchId | null = null;
    public renameValue: string = '';

    @Watch('search', { immediate: true })
    public async onChangeSearch(newKeyword: string | undefined): Promise<void> {
        if (typeof newKeyword === 'undefined' || newKeyword === this.searchState.ruleKeyword) {
            return;
        }

        this.searchState.ruleKeyword = newKeyword;
        await this.searchState.updateRuleItems();
    }

    public isOpen: boolean = false;
    public searchState: IRecordedSearchState = container.get<IRecordedSearchState>('IRecordedSearchState');

    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private savedSearchApiModel: ISavedSearchApiModel = container.get<ISavedSearchApiModel>('ISavedSearchApiModel');
    private serverConfigModel: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');

    /**
     * advancedSearch 機能フラグが有効か。無効な場合、高度検索構文ヒント・階層タグ・保存検索 UI は一切表示しない
     */
    public get isAdvancedSearchEnabled(): boolean {
        return isFeatureEnabled(this.serverConfigModel.getConfig(), 'advancedSearch');
    }

    public onCancel(): void {
        this.isOpen = false;
    }

    private buildSearchQuery(): Record<string, any> {
        const searchQuery: Record<string, any> = {};
        if (typeof this.searchState.keyword !== 'undefined' && this.searchState.keyword.length > 0) {
            searchQuery.keyword = this.searchState.keyword;
        }
        if (this.isNoRule === true) {
            searchQuery.ruleId = 0;
        } else if (typeof this.searchState.ruleId !== 'undefined' && this.searchState.ruleId !== null) {
            searchQuery.ruleId = this.searchState.ruleId;
        }
        if (typeof this.searchState.channelId !== 'undefined' && this.searchState.channelId !== null) {
            searchQuery.channelId = this.searchState.channelId;
        }
        if (typeof this.searchState.genre !== 'undefined' && this.searchState.genre !== null) {
            searchQuery.genre = this.searchState.genre;
        }
        if (this.isAdvancedSearchEnabled === true && typeof this.searchState.tagId !== 'undefined' && this.searchState.tagId !== null) {
            searchQuery.tagId = this.searchState.tagId;
        }
        if (this.searchState.hasOriginalFile === true) {
            searchQuery.hasOriginalFile = true;
        }

        return searchQuery;
    }

    public onSearch(): void {
        this.isOpen = false;

        this.$nextTick(async () => {
            await Util.sleep(300);

            if (this.isNoRule === true) {
                this.searchState.ruleId = 0;
            }

            await Util.move(this.$router, {
                path: '/recorded',
                query: this.buildSearchQuery(),
            });
        });
    }

    public onClickMenuBackground(e: Event): boolean {
        e.stopPropagation();

        return false;
    }

    public async saveCurrentSearch(): Promise<void> {
        if (this.newSavedSearchName.length === 0) {
            return;
        }
        this.savingSearch = true;
        try {
            await this.savedSearchApiModel.add({
                name: this.newSavedSearchName,
                query: JSON.stringify(this.buildSearchQuery()),
            });
            this.newSavedSearchName = '';
            await this.loadSavedSearches();
            this.snackbarState.open({ color: 'success', text: '検索条件を保存しました' });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '検索条件の保存に失敗しました' });
        } finally {
            this.savingSearch = false;
        }
    }

    public async loadSavedSearches(): Promise<void> {
        try {
            const result = await this.savedSearchApiModel.gets();
            // ピン留めを先頭に
            this.savedSearches = [...result.items].sort((a, b) => Number(b.isPinned) - Number(a.isPinned));
        } catch (err) {
            console.error(err);
        }
    }

    public applySavedSearch(item: apid.SavedSearchItem): void {
        let query: Record<string, any> = {};
        try {
            query = JSON.parse(item.query);
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '保存検索の条件を読み込めませんでした' });
            return;
        }

        this.isOpen = false;
        this.$nextTick(async () => {
            await Util.move(this.$router, {
                path: '/recorded',
                query: query,
            });
        });
    }

    public async togglePin(item: apid.SavedSearchItem): Promise<void> {
        try {
            await this.savedSearchApiModel.update(item.id, { name: item.name, query: item.query, isPinned: !item.isPinned });
            await this.loadSavedSearches();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'ピン留めの更新に失敗しました' });
        }
    }

    public startRename(item: apid.SavedSearchItem): void {
        this.renamingId = item.id;
        this.renameValue = item.name;
    }

    public async commitRename(item: apid.SavedSearchItem): Promise<void> {
        if (this.renameValue.length === 0) {
            return;
        }
        try {
            await this.savedSearchApiModel.update(item.id, { name: this.renameValue, query: item.query, isPinned: item.isPinned });
            this.renamingId = null;
            await this.loadSavedSearches();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '保存検索の名前変更に失敗しました' });
        }
    }

    public async deleteSavedSearch(item: apid.SavedSearchItem): Promise<void> {
        try {
            await this.savedSearchApiModel.delete(item.id);
            await this.loadSavedSearches();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '保存検索の削除に失敗しました' });
        }
    }

    /**
     * ページ移動時
     */
    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.isOpen = false;

        this.setRuleId();
        this.searchState.fetchData().catch(err => {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: '録画検索オプションの取得に失敗',
            });
        });
    }

    private setRuleId(): void {
        const ruleId = typeof this.$route.query.ruleId === 'undefined' ? null : parseInt(this.$route.query.ruleId as string, 10);
        this.searchState.ruleId = ruleId === null || isNaN(ruleId) === false ? ruleId : null;
        if (this.searchState.ruleId === 0) {
            this.isNoRule = true;
        }
    }

    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === true && oldState === false) {
            this.searchState.initValues();
            this.isNoRule = false;

            // query から値をセット
            this.setRuleId();
            if (typeof this.$route.query.keyword === 'string') {
                this.searchState.keyword = this.$route.query.keyword;
            }
            if (typeof this.$route.query.channelId !== 'undefined') {
                this.searchState.channelId = parseInt(this.$route.query.channelId as string, 10);
            }
            if (typeof this.$route.query.genre !== 'undefined') {
                this.searchState.genre = parseInt(this.$route.query.genre as string, 10);
            }
            if (typeof this.$route.query.tagId !== 'undefined') {
                this.searchState.tagId = parseInt(this.$route.query.tagId as string, 10);
            }
            if (typeof this.$route.query.hasOriginalFile !== 'undefined') {
                this.searchState.hasOriginalFile = (this.$route.query.hasOriginalFile as any) === true || this.$route.query.hasOriginalFile === 'true';
            }

            if (this.isAdvancedSearchEnabled === true) {
                this.searchState.fetchTagItems().catch(err => {
                    console.error(err);
                });
                this.loadSavedSearches().catch(err => {
                    console.error(err);
                });
            }

            // キーワードにフォーカスを当てる
            this.$nextTick(() => {
                if (typeof this.$refs.keyword !== 'undefined') {
                    VuetifyUtil.focusTextFiled(this.$refs.keyword as ComponentPublicInstance);
                }
            });
        }
    }
}

export default toNative(RecordedSearchMenu);
</script>

<style lang="sass">
.recorded-search
    .v-input__control
        .v-input__slot
            margin: 0 !important
        .v-messages
            display: none

    .check-boxes
        display: flex
        flex-wrap: wrap
        .v-input--checkbox
            padding-right: 8px

    .saved-search-list
        max-height: 200px
        overflow-y: auto
</style>
