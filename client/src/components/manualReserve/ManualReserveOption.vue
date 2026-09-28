<template>
    <v-card>
        <div class="pa-4 manual-reserve-option">
            <v-expansion-panels v-model="manualReserveState.optionPanel" accordion multiple flat class="option-panels">
                <v-expansion-panel>
                    <v-expansion-panel-title>オプション</v-expansion-panel-title>
                    <v-expansion-panel-text>
                        <SearchOptionRow>
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
    </v-card>
</template>

<script lang="ts">
import SearchOptionRow from '@/components/search/SearchOptionRow.vue';
import container from '@/model/ModelContainer';
import IManualReserveState from '@/model/state/reserve/manual/IManualReserveState';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';

@Component({
    components: {
        SearchOptionRow,
    },
})
class ManualReserveOption extends Vue {
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
