<template>
    <div v-if="searchState.getSearchResult() !== null || searchState.isTimeSpecification === true" class="search-rule-option">
        <v-card class="mx-auto" max-width="800">
            <div class="pa-4">
                <v-expansion-panels v-model="searchState.optionPanel" accordion multiple flat class="option-panels">
                    <v-expansion-panel>
                        <v-expansion-panel-title>オプション</v-expansion-panel-title>
                        <v-expansion-panel-text>
                            <SearchOptionRow>
                                <div class="d-flex flex-wrap">
                                    <v-checkbox class="mx-1 my-0" v-model="reserveOptionValue.enable" label="有効"></v-checkbox>
                                    <v-checkbox class="mx-1 my-0" v-model="reserveOptionValue.allowEndLack" label="状況に応じて末尾がかけることを許可"></v-checkbox>
                                </div>
                            </SearchOptionRow>
                        </v-expansion-panel-text>
                    </v-expansion-panel>
                    <v-expansion-panel>
                        <v-expansion-panel-title>重複</v-expansion-panel-title>
                        <v-expansion-panel-text>
                            <SearchOptionRow>
                                <v-text-field class="period" v-model="reserveOptionValue.periodToAvoidDuplicate" min="0" label="日数" type="number" clearable></v-text-field>
                                <v-checkbox class="mx-1 my-0" v-model="reserveOptionValue.avoidDuplicate" label="録画済み番組を排除"></v-checkbox>
                            </SearchOptionRow>
                        </v-expansion-panel-text>
                    </v-expansion-panel>
                    <v-expansion-panel>
                        <v-expansion-panel-title>ディレクトリ</v-expansion-panel-title>
                        <v-expansion-panel-text>
                            <SearchOptionRow>
                                <v-select
                                    class="directory"
                                    v-model="saveOptionValue.parentDirectoryName"
                                    :items="searchState.getPrentDirectoryItems()"
                                    label="directory"
                                    clearable
                                ></v-select>
                                <v-text-field v-model="saveOptionValue.directory" label="sub directory" clearable></v-text-field>
                            </SearchOptionRow>
                        </v-expansion-panel-text>
                    </v-expansion-panel>
                    <v-expansion-panel>
                        <v-expansion-panel-title>ファイル名形式</v-expansion-panel-title>
                        <v-expansion-panel-text>
                            <SearchOptionRow>
                                <v-text-field v-model="saveOptionValue.recordedFormat" label="file format" clearable></v-text-field>
                            </SearchOptionRow>
                        </v-expansion-panel-text>
                    </v-expansion-panel>
                    <v-expansion-panel v-if="searchState.isEnableEncodeMode() === true">
                        <v-expansion-panel-title>エンコード1</v-expansion-panel-title>
                        <v-expansion-panel-text>
                            <SearchOptionRow>
                                <v-select
                                    class="encode-mode"
                                    v-model="encodeOptionValue.mode1"
                                    :items="searchState.getEncodeModeItems()"
                                    label="mode1"
                                    clearable
                                ></v-select>
                                <v-select
                                    class="directory"
                                    v-model="encodeOptionValue.encodeParentDirectoryName1"
                                    :items="searchState.getPrentDirectoryItems()"
                                    label="directory1"
                                    clearable
                                ></v-select>
                                <v-text-field v-model="encodeOptionValue.directory1" label="sub directory1" clearable></v-text-field>
                            </SearchOptionRow>
                        </v-expansion-panel-text>
                    </v-expansion-panel>
                    <v-expansion-panel v-if="searchState.isEnableEncodeMode() === true">
                        <v-expansion-panel-title>エンコード2</v-expansion-panel-title>
                        <v-expansion-panel-text>
                            <SearchOptionRow>
                                <v-select
                                    class="encode-mode"
                                    v-model="encodeOptionValue.mode2"
                                    :items="searchState.getEncodeModeItems()"
                                    label="mode2"
                                    clearable
                                ></v-select>
                                <v-select
                                    class="directory"
                                    v-model="encodeOptionValue.encodeParentDirectoryName2"
                                    :items="searchState.getPrentDirectoryItems()"
                                    label="directory2"
                                    clearable
                                ></v-select>
                                <v-text-field v-model="encodeOptionValue.directory2" label="sub directory2" clearable></v-text-field>
                            </SearchOptionRow>
                        </v-expansion-panel-text>
                    </v-expansion-panel>
                    <v-expansion-panel v-if="searchState.isEnableEncodeMode() === true">
                        <v-expansion-panel-title>エンコード3</v-expansion-panel-title>
                        <v-expansion-panel-text>
                            <SearchOptionRow>
                                <v-select
                                    class="encode-mode"
                                    v-model="encodeOptionValue.mode3"
                                    :items="searchState.getEncodeModeItems()"
                                    label="mode3"
                                    clearable
                                ></v-select>
                                <v-select
                                    class="directory"
                                    v-model="encodeOptionValue.encodeParentDirectoryName3"
                                    :items="searchState.getPrentDirectoryItems()"
                                    label="directory3"
                                    clearable
                                ></v-select>
                                <v-text-field v-model="encodeOptionValue.directory3" label="sub directory3" clearable></v-text-field>
                            </SearchOptionRow>
                        </v-expansion-panel-text>
                    </v-expansion-panel>
                    <v-expansion-panel v-if="searchState.isEnableEncodeMode() === true">
                        <v-expansion-panel-title>ファイル削除</v-expansion-panel-title>
                        <v-expansion-panel-text>
                            <SearchOptionRow>
                                <v-checkbox class="mx-1 my-0" v-model="encodeOptionValue.isDeleteOriginalAfterEncode" label="元ファイルの自動削除"></v-checkbox>
                            </SearchOptionRow>
                        </v-expansion-panel-text>
                    </v-expansion-panel>
                </v-expansion-panels>
            </div>
            <v-divider></v-divider>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn v-on:click="onClickCancel" variant="text" color="error">キャンセル</v-btn>
                <v-btn v-if="this.searchState.isEditingRule() === true" v-on:click="onClickUpdate" variant="text" color="primary">更新</v-btn>
                <v-btn v-else v-on:click="onClickAdd" variant="text" color="primary">追加</v-btn>
            </v-card-actions>
        </v-card>
    </div>
</template>

<script lang="ts">
import SearchOptionRow from '@/components/search/SearchOptionRow.vue';
import container from '@/model/ModelContainer';
import ISearchState, { EncodedOption, ReserveOption, SaveOption } from '@/model/state/search/ISearchState';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';

@Component({
    components: {
        SearchOptionRow,
    },
})
class SearchRuleOption extends Vue {
    public searchState: ISearchState = container.get<ISearchState>('ISearchState');


    get reserveOptionValue(): ReserveOption {
        if (this.searchState.reserveOption === null) {
            throw new Error('ReserveOptionIsNotInitialized');
        }
        return this.searchState.reserveOption;
    }

    get saveOptionValue(): SaveOption {
        if (this.searchState.saveOption === null) {
            throw new Error('SaveOptionIsNotInitialized');
        }
        return this.searchState.saveOption;
    }

    get encodeOptionValue(): EncodedOption {
        if (this.searchState.encodeOption === null) {
            throw new Error('EncodeOptionIsNotInitialized');
        }
        return this.searchState.encodeOption;
    }

    public onClickCancel(): void {
        this.$emit('cancel');
    }

    public onClickAdd(): void {
        this.$emit('add');
    }

    public onClickUpdate(): void {
        this.$emit('update');
    }
}

export default toNative(SearchRuleOption);
</script>

<style lang="sass" scoped>
.search-rule-option
    .period
        max-width: 90px
    .directory
        max-width: 150px
    .encode-mode
        max-width: 150px
    .option-panels
        .v-expansion-panel-header
            padding: 6px 0
            min-height: 38px
        .v-expansion-panel-content__wrap
            padding: 0
</style>

<style lang="sass">
.search-rule-option
    .v-input__control
        .v-input__slot
            margin: 0 !important
        .v-messages
            display: none
</style>
