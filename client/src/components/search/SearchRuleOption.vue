<template>
    <div v-if="searchState.getSearchResult() !== null || searchState.isTimeSpecification === true" class="search-rule-option">
        <v-card class="mx-auto" max-width="800">
            <div class="pa-4">
                <div class="d-flex flex-wrap align-center ga-2 mb-3">
                    <v-select
                        v-model="selectedPresetId"
                        :items="presets.map(item => ({ title: item.name, value: item.id }))"
                        label="録画プリセット"
                        clearable
                        hide-details
                        class="preset-select"
                    ></v-select>
                    <v-btn variant="outlined" :disabled="selectedPresetId === null" @click="applySelectedPreset">読み込む</v-btn>
                    <v-btn variant="outlined" @click="isSavePresetDialogOpen = true">現在の設定を保存</v-btn>
                </div>
                <v-expansion-panels v-model="searchState.optionPanel" accordion multiple flat class="option-panels">
                    <v-expansion-panel>
                        <v-expansion-panel-title>オプション</v-expansion-panel-title>
                        <v-expansion-panel-text>
                            <SearchOptionRow>
                                <div class="d-flex flex-wrap">
                                    <v-text-field
                                        class="margin-input"
                                        v-model.number="reserveOptionValue.startMarginSec"
                                        label="開始マージン (秒)"
                                        type="number"
                                        min="0"
                                        max="3600"
                                        clearable
                                        :hint="searchState.getRecordingMarginHint()"
                                        persistent-hint
                                    ></v-text-field>
                                    <v-text-field
                                        class="margin-input"
                                        v-model.number="reserveOptionValue.endMarginSec"
                                        label="終了マージン (秒)"
                                        type="number"
                                        min="0"
                                        max="3600"
                                        clearable
                                        hint="空欄なら全体設定 (現在 開始 5 秒 / 終了 5 秒)"
                                        persistent-hint
                                    ></v-text-field>
                                </div>
                                <div class="d-flex flex-wrap">
                                    <v-checkbox class="mx-1 my-0" v-model="reserveOptionValue.enable" label="有効"></v-checkbox>
                                    <v-select class="policy-input" v-model="reserveOptionValue.priority" :items="priorityItems" label="優先度" density="compact"></v-select>
                                    <v-select
                                        class="policy-input"
                                        v-model="reserveOptionValue.conflictPolicy"
                                        :items="conflictPolicyItems"
                                        label="競合時の扱い"
                                        density="compact"
                                        hint="許可した欠け方の範囲で競合を許容。優先度で下位予約を押し出す設定も可能。"
                                        persistent-hint
                                    ></v-select>
                                </div>
                                <v-select class="finish-command-input" v-model="finishCommandName" :items="finishCommandItems" label="録画後コマンド" clearable></v-select>
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
                                <v-select class="encode-mode" v-model="encodeOptionValue.mode1" :items="searchState.getEncodeModeItems()" label="mode1" clearable></v-select>
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
                                <v-select class="encode-mode" v-model="encodeOptionValue.mode2" :items="searchState.getEncodeModeItems()" label="mode2" clearable></v-select>
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
                                <v-select class="encode-mode" v-model="encodeOptionValue.mode3" :items="searchState.getEncodeModeItems()" label="mode3" clearable></v-select>
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
                <v-btn v-if="searchState.isEditingRule() === true" v-on:click="onClickUpdate" variant="text" color="primary">更新</v-btn>
                <v-btn v-else v-on:click="onClickAdd" variant="text" color="primary">追加</v-btn>
            </v-card-actions>
            <v-dialog v-model="isSavePresetDialogOpen" max-width="420">
                <v-card>
                    <v-card-title>録画プリセットを保存</v-card-title>
                    <v-card-text><v-text-field v-model="newPresetName" label="名前" autofocus></v-text-field></v-card-text>
                    <v-card-actions>
                        <v-spacer></v-spacer>
                        <v-btn variant="text" @click="isSavePresetDialogOpen = false">キャンセル</v-btn>
                        <v-btn color="primary" @click="saveCurrentAsPreset">保存</v-btn>
                    </v-card-actions>
                </v-card>
            </v-dialog>
        </v-card>
    </div>
</template>

<script lang="ts">
import SearchOptionRow from '@/components/search/SearchOptionRow.vue';
import container from '@/model/ModelContainer';
import ISearchState, { EncodedOption, ReserveOption, SaveOption } from '@/model/state/search/ISearchState';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';

@Component({
    components: {
        SearchOptionRow,
    },
})
class SearchRuleOption extends Vue {
    public presets: import('@/model/api/recordingPreset/IRecordingPresetApiModel').RecordingPresetItem[] = [];
    public selectedPresetId: number | null = null;
    public isSavePresetDialogOpen: boolean = false;
    public newPresetName: string = '';
    private presetState = container.get<import('@/model/state/recordingPreset/IRecordingPresetState').default>('IRecordingPresetState');
    public priorityItems = [
        { title: '最高', value: 5 },
        { title: '高', value: 4 },
        { title: '普通', value: 3 },
        { title: '低', value: 2 },
        { title: '最低', value: 1 },
    ];
    public conflictPolicyItems = [
        { title: '厳格', value: 'STRICT' },
        { title: '末尾欠け許可', value: 'ALLOW_END_LACK' },
        { title: '先頭欠け許可', value: 'ALLOW_HEAD_LACK' },
        { title: '一部欠け許可', value: 'ALLOW_PARTIAL' },
        { title: '下位予約を押し出す', value: 'PREEMPT_LOWER_PRIORITY' },
    ];
    public searchState: ISearchState = container.get<ISearchState>('ISearchState');
    private serverConfigModel: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');

    get finishCommandItems(): Array<{ title: string; value: string | null }> {
        const names = (this.serverConfigModel.getConfig() as any)?.recordingFinishCommandNames ?? [];
        return [{ title: '既定のコマンド', value: null }, ...names.map((name: string) => ({ title: name, value: name }))];
    }

    get finishCommandName(): string | null {
        return (this.reserveOptionValue as ReserveOption & { finishCommandName?: string | null }).finishCommandName ?? null;
    }

    set finishCommandName(value: string | null) {
        (this.reserveOptionValue as ReserveOption & { finishCommandName?: string | null }).finishCommandName = value;
    }

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

    public async created(): Promise<void> {
        await this.presetState.fetch();
        this.presets = this.presetState.getItems();
        if (this.searchState.isEditingRule() === false) {
            const preset = await this.presetState.getDefault();
            if (preset !== null) this.applyPreset(preset.settings);
        }
    }

    public applySelectedPreset(): void {
        const preset = this.presets.find(item => item.id === this.selectedPresetId);
        if (preset !== undefined) this.applyPreset(preset.settings);
    }

    private applyPreset(settings: import('@/model/api/recordingPreset/IRecordingPresetApiModel').RecordingPresetSettings): void {
        Object.assign(this.reserveOptionValue, {
            priority: settings.priority,
            conflictPolicy: settings.conflictPolicy as any,
            allowEndLack: settings.allowEndLack,
            startMarginSec: settings.startMarginSec,
            endMarginSec: settings.endMarginSec,
            tags: [...settings.tags],
        });
        Object.assign(this.saveOptionValue, { parentDirectoryName: settings.parentDirectoryName, directory: settings.directory, recordedFormat: settings.recordedFormat });
        Object.assign(this.encodeOptionValue, {
            mode1: settings.mode1,
            encodeParentDirectoryName1: settings.encodeParentDirectoryName1,
            directory1: settings.directory1,
            mode2: settings.mode2,
            encodeParentDirectoryName2: settings.encodeParentDirectoryName2,
            directory2: settings.directory2,
            mode3: settings.mode3,
            encodeParentDirectoryName3: settings.encodeParentDirectoryName3,
            directory3: settings.directory3,
            isDeleteOriginalAfterEncode: settings.isDeleteOriginalAfterEncode,
        });
    }

    public async saveCurrentAsPreset(): Promise<void> {
        if (this.newPresetName.trim() === '') return;
        const current = this.presets.find(item => item.id === this.selectedPresetId);
        const settings = {
            ...(current?.settings ?? {}),
            parentDirectoryName: this.saveOptionValue.parentDirectoryName,
            directory: this.saveOptionValue.directory,
            recordedFormat: this.saveOptionValue.recordedFormat,
            ...this.encodeOptionValue,
            priority: this.reserveOptionValue.priority,
            conflictPolicy: this.reserveOptionValue.conflictPolicy,
            allowEndLack: this.reserveOptionValue.allowEndLack,
            startMarginSec: this.reserveOptionValue.startMarginSec,
            endMarginSec: this.reserveOptionValue.endMarginSec,
            tags: [...this.reserveOptionValue.tags],
        } as import('@/model/api/recordingPreset/IRecordingPresetApiModel').RecordingPresetSettings;
        await this.presetState.add({ name: this.newPresetName.trim(), settings });
        this.presets = this.presetState.getItems();
        this.isSavePresetDialogOpen = false;
        this.newPresetName = '';
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
    .preset-select
        min-width: 180px
        max-width: 320px
    .policy-input
        max-width: 240px
        min-width: 160px
        flex: 1 1 180px
    .finish-command-input
        max-width: 320px
        min-width: 180px
        flex: 1 1 240px
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
</style>
