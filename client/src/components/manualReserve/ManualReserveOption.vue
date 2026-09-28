<template>
    <v-card>
        <div class="pa-4 manual-reserve-option">
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
            <v-expansion-panels v-model="manualReserveState.optionPanel" accordion multiple flat class="option-panels">
                <v-expansion-panel>
                    <v-expansion-panel-title>オプション</v-expansion-panel-title>
                    <v-expansion-panel-text>
                        <SearchOptionRow>
                            <div class="d-flex flex-wrap">
                                <v-text-field
                                    class="margin-input"
                                    v-model.number="manualReserveState.reserveOption.startMarginSec"
                                    label="開始マージン (秒)"
                                    type="number"
                                    min="0"
                                    max="3600"
                                    clearable
                                    :hint="manualReserveState.getRecordingMarginHint()"
                                    persistent-hint
                                ></v-text-field>
                                <v-text-field
                                    class="margin-input"
                                    v-model.number="manualReserveState.reserveOption.endMarginSec"
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
                                <v-select
                                    class="policy-input"
                                    v-model="manualReserveState.reserveOption.priority"
                                    :items="priorityItems"
                                    label="優先度"
                                    density="compact"
                                ></v-select>
                                <v-select
                                    class="policy-input"
                                    v-model="manualReserveState.reserveOption.conflictPolicy"
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
                    <v-expansion-panel-title>ディレクトリ</v-expansion-panel-title>
                    <v-expansion-panel-text>
                        <SearchOptionRow>
                            <v-select
                                class="directory"
                                v-model="manualReserveState.saveOption.parentDirectoryName"
                                :items="manualReserveState.getPrentDirectoryItems()"
                                label="directory"
                                clearable
                            ></v-select>
                            <v-text-field v-model="manualReserveState.saveOption.directory" label="sub directory" clearable></v-text-field>
                        </SearchOptionRow>
                    </v-expansion-panel-text>
                </v-expansion-panel>
                <v-expansion-panel>
                    <v-expansion-panel-title>ファイル名形式</v-expansion-panel-title>
                    <v-expansion-panel-text>
                        <SearchOptionRow>
                            <v-text-field v-model="manualReserveState.saveOption.recordedFormat" label="file format" clearable></v-text-field>
                        </SearchOptionRow>
                    </v-expansion-panel-text>
                </v-expansion-panel>
                <v-expansion-panel v-if="manualReserveState.isEnableEncodeMode() === true">
                    <v-expansion-panel-title>エンコード1</v-expansion-panel-title>
                    <v-expansion-panel-text>
                        <SearchOptionRow>
                            <v-select
                                class="encode-mode"
                                v-model="manualReserveState.encodeOption.mode1"
                                :items="manualReserveState.getEncodeModeItems()"
                                label="mode1"
                                clearable
                            ></v-select>
                            <v-select
                                class="directory"
                                v-model="manualReserveState.encodeOption.encodeParentDirectoryName1"
                                :items="manualReserveState.getPrentDirectoryItems()"
                                label="directory1"
                                clearable
                            ></v-select>
                            <v-text-field v-model="manualReserveState.encodeOption.directory1" label="sub directory1" clearable></v-text-field>
                        </SearchOptionRow>
                    </v-expansion-panel-text>
                </v-expansion-panel>
                <v-expansion-panel v-if="manualReserveState.isEnableEncodeMode() === true">
                    <v-expansion-panel-title>エンコード2</v-expansion-panel-title>
                    <v-expansion-panel-text>
                        <SearchOptionRow>
                            <v-select
                                class="encode-mode"
                                v-model="manualReserveState.encodeOption.mode2"
                                :items="manualReserveState.getEncodeModeItems()"
                                label="mode2"
                                clearable
                            ></v-select>
                            <v-select
                                class="directory"
                                v-model="manualReserveState.encodeOption.encodeParentDirectoryName2"
                                :items="manualReserveState.getPrentDirectoryItems()"
                                label="directory2"
                                clearable
                            ></v-select>
                            <v-text-field v-model="manualReserveState.encodeOption.directory2" label="sub directory2" clearable></v-text-field>
                        </SearchOptionRow>
                    </v-expansion-panel-text>
                </v-expansion-panel>
                <v-expansion-panel v-if="manualReserveState.isEnableEncodeMode() === true">
                    <v-expansion-panel-title>エンコード3</v-expansion-panel-title>
                    <v-expansion-panel-text>
                        <SearchOptionRow>
                            <v-select
                                class="encode-mode"
                                v-model="manualReserveState.encodeOption.mode3"
                                :items="manualReserveState.getEncodeModeItems()"
                                label="mode3"
                                clearable
                            ></v-select>
                            <v-select
                                class="directory"
                                v-model="manualReserveState.encodeOption.encodeParentDirectoryName3"
                                :items="manualReserveState.getPrentDirectoryItems()"
                                label="directory3"
                                clearable
                            ></v-select>
                            <v-text-field v-model="manualReserveState.encodeOption.directory3" label="sub directory3" clearable></v-text-field>
                        </SearchOptionRow>
                    </v-expansion-panel-text>
                </v-expansion-panel>
                <v-expansion-panel v-if="manualReserveState.isEnableEncodeMode() === true">
                    <v-expansion-panel-title>ファイル削除</v-expansion-panel-title>
                    <v-expansion-panel-text>
                        <SearchOptionRow>
                            <v-checkbox class="mx-1 my-0" v-model="manualReserveState.encodeOption.isDeleteOriginalAfterEncode" label="元ファイルの自動削除"></v-checkbox>
                        </SearchOptionRow>
                    </v-expansion-panel-text>
                </v-expansion-panel>
            </v-expansion-panels>
        </div>
        <v-divider></v-divider>
        <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn variant="text" color="error" v-on:click="cancel">キャンセル</v-btn>
            <v-btn v-if="isEditMode === false" variant="text" color="primary" v-on:click="add">追加</v-btn>
            <v-btn v-else variant="text" color="primary" v-on:click="update">更新</v-btn>
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
</template>

<script lang="ts">
import SearchOptionRow from '@/components/search/SearchOptionRow.vue';
import container from '@/model/ModelContainer';
import IManualReserveState from '@/model/state/reserve/manual/IManualReserveState';
import IRecordingPresetState from '@/model/state/recordingPreset/IRecordingPresetState';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import { RecordingPresetItem, RecordingPresetSettings } from '@/model/api/recordingPreset/IRecordingPresetApiModel';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';

@Component({
    components: {
        SearchOptionRow,
    },
})
class ManualReserveOption extends Vue {
    public presets: RecordingPresetItem[] = [];
    public selectedPresetId: number | null = null;
    public isSavePresetDialogOpen: boolean = false;
    public newPresetName: string = '';
    private presetState: IRecordingPresetState = container.get<IRecordingPresetState>('IRecordingPresetState');
    private serverConfigModel: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');

    get finishCommandItems(): Array<{ title: string; value: string | null }> {
        const names = (this.serverConfigModel.getConfig() as any)?.recordingFinishCommandNames ?? [];
        return [{ title: '既定のコマンド', value: null }, ...names.map((name: string) => ({ title: name, value: name }))];
    }

    get finishCommandName(): string | null {
        return (this.manualReserveState.reserveOption as typeof this.manualReserveState.reserveOption & { finishCommandName?: string | null }).finishCommandName ?? null;
    }

    set finishCommandName(value: string | null) {
        (this.manualReserveState.reserveOption as typeof this.manualReserveState.reserveOption & { finishCommandName?: string | null }).finishCommandName = value;
    }

    public async created(): Promise<void> {
        await this.presetState.fetch();
        this.presets = this.presetState.getItems();
        if (this.isEditMode === false) {
            const preset = await this.presetState.getDefault();
            if (preset !== null) this.applyPreset(preset.settings);
        }
    }

    public applySelectedPreset(): void {
        const preset = this.presets.find(item => item.id === this.selectedPresetId);
        if (preset !== undefined) this.applyPreset(preset.settings);
    }

    private applyPreset(settings: RecordingPresetSettings): void {
        Object.assign(this.manualReserveState.reserveOption, {
            priority: settings.priority,
            conflictPolicy: settings.conflictPolicy as any,
            allowEndLack: settings.allowEndLack,
            startMarginSec: settings.startMarginSec,
            endMarginSec: settings.endMarginSec,
            tags: [...settings.tags],
            finishCommandName: settings.finishCommandName ?? null,
        });
        Object.assign(this.manualReserveState.saveOption, {
            parentDirectoryName: settings.parentDirectoryName,
            directory: settings.directory,
            recordedFormat: settings.recordedFormat,
        });
        Object.assign(this.manualReserveState.encodeOption, {
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
            parentDirectoryName: this.manualReserveState.saveOption.parentDirectoryName,
            directory: this.manualReserveState.saveOption.directory,
            recordedFormat: this.manualReserveState.saveOption.recordedFormat,
            ...this.manualReserveState.encodeOption,
            priority: this.manualReserveState.reserveOption.priority,
            conflictPolicy: this.manualReserveState.reserveOption.conflictPolicy,
            allowEndLack: this.manualReserveState.reserveOption.allowEndLack,
            startMarginSec: this.manualReserveState.reserveOption.startMarginSec,
            endMarginSec: this.manualReserveState.reserveOption.endMarginSec,
            tags: [...this.manualReserveState.reserveOption.tags],
            finishCommandName: this.finishCommandName,
        } as RecordingPresetSettings;
        await this.presetState.add({ name: this.newPresetName.trim(), settings });
        this.presets = this.presetState.getItems();
        this.isSavePresetDialogOpen = false;
        this.newPresetName = '';
    }
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
    @Prop({ required: true })
    public isEditMode!: boolean;

    public manualReserveState: IManualReserveState = container.get<IManualReserveState>('IManualReserveState');

    public cancel(): void {
        this.$emit('cancel');
    }

    public add(): void {
        this.$emit('add');
    }

    public update(): void {
        this.$emit('update');
    }
}

export default toNative(ManualReserveOption);
</script>

<style lang="sass" scoped>
.manual-reserve-option
    .policy-input
        max-width: 220px
        min-width: 160px
        flex: 1 1 180px
    .finish-command-input
        max-width: 320px
        min-width: 180px
        flex: 1 1 240px
    .directory
        max-width: 150px
    .option-panels
        .v-expansion-panel-header
            padding: 6px 0
            min-height: 38px
        .v-expansion-panel-content__wrap
            padding: 0
</style>

<style lang="sass">
.manual-reserve-option
    .v-input__control
        .v-input__slot
            margin: 0 !important
</style>
