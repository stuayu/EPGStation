<template>
    <v-dialog v-if="isRemove === false" v-model="dialogModel" max-width="500" scrollable>
        <v-card>
            <div class="pa-3 pt-4 pb-0 multiple-encode">
                <div class="text-subtitle-1">選択した {{ total }} 件の番組をエンコードします</div>
                <div class="d-flex">
                    <v-select :items="sourceTypeItems" v-model="sourceType" label="source" class="source"></v-select>
                    <v-select :items="encodeList" v-model="encodeMode" label="preset" class="preset"></v-select>
                </div>

                <div class="directory">
                    <v-select
                        :items="parentDirectoryList"
                        v-model="parentDirectory"
                        label="recorded"
                        :disabled="setting.tmp.isSaveSameDirectory === true"
                        class="parent"
                    ></v-select>
                    <v-text-field
                        v-model="directory"
                        label="sub directory"
                        clearable
                        :disabled="setting.tmp.isSaveSameDirectory === true"
                        class="sub"
                    ></v-text-field>
                </div>

                <v-checkbox v-model="setting.tmp.isSaveSameDirectory" class="mx-1 my-0" label="元ファイルと同じ場所に保存する"></v-checkbox>
                <v-checkbox v-model="setting.tmp.removeOriginal" class="mx-1 my-0" label="元ファイルを削除する"></v-checkbox>
                <div class="text-caption text-grey px-1 pb-2">選択した種別のビデオファイルを持たない番組は追加されません。</div>
            </div>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn v-on:click="cancel" variant="text" color="error">キャンセル</v-btn>
                <v-btn v-on:click="add" variant="text" color="primary">追加</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import { MultipleEncodeOption } from '@/model/state/recorded/IRecordedState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { IAddEncodeSettingStorageModel } from '@/model/storage/encode/IAddEncodeSettingStorageModel';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';

@Component({})
class RecordedMultipleEncodeDialog extends Vue {
    @Prop({ required: true })
    public isOpen!: boolean;

    @Prop({ required: true })
    public total!: number;

    public setting: IAddEncodeSettingStorageModel = container.get<IAddEncodeSettingStorageModel>('IAddEncodeSettingStorageModel');
    private serverConfig: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    public isRemove: boolean = false;

    public sourceType: 'ts' | 'encoded' = 'ts';
    public encodeMode: string | null = null;
    public parentDirectory: string | null = null;
    public directory: string | null = null;

    public sourceTypeItems: { title: string; value: 'ts' | 'encoded' }[] = [
        {
            title: 'TS',
            value: 'ts',
        },
        {
            title: 'エンコード済み',
            value: 'encoded',
        },
    ];

    get encodeList(): string[] {
        const config = this.serverConfig.getConfig();

        return config === null ? [] : config.encode;
    }

    get parentDirectoryList(): string[] {
        const config = this.serverConfig.getConfig();

        return config === null ? [] : config.recorded;
    }

    /**
     * Prop で受け取った isOpen を直接は書き換えられないので
     * getter, setter を用意する
     */
    get dialogModel(): boolean {
        return this.isOpen;
    }
    set dialogModel(value: boolean) {
        this.$emit('update:isOpen', value);
    }

    public cancel(): void {
        this.dialogModel = false;
    }

    /**
     * 入力内容を MultipleEncodeOption にして親へ渡す
     */
    public add(): void {
        if (this.encodeMode === null) {
            this.snackbarState.open({
                color: 'error',
                text: 'エンコード設定が指定されていません',
            });

            return;
        }

        const option: MultipleEncodeOption = {
            mode: this.encodeMode,
            sourceType: this.sourceType,
            isSaveSameDirectory: this.setting.tmp.isSaveSameDirectory === true,
            removeOriginal: this.setting.tmp.removeOriginal === true,
        };

        if (option.isSaveSameDirectory === false) {
            if (this.parentDirectory === null) {
                this.snackbarState.open({
                    color: 'error',
                    text: '保存先が指定されていません',
                });

                return;
            }
            option.parentDir = this.parentDirectory;

            if (this.directory !== null && this.directory.length > 0) {
                option.directory = this.directory;
            }
        }

        this.$emit('encode', option);
    }

    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === true && !!oldState === false) {
            // open
            const settingValue = this.setting.getSavedValue();
            this.directory = null;
            this.encodeMode = this.encodeList.length === 0 ? null : this.encodeList.find(e => e === settingValue.encodeMode) ?? this.encodeList[0];
            this.parentDirectory =
                this.parentDirectoryList.length === 0 ? null : this.parentDirectoryList.find(d => d === settingValue.parentDirectory) ?? this.parentDirectoryList[0];
        } else if (newState === false && oldState === true) {
            // close
            this.setting.tmp.encodeMode = this.encodeMode;
            this.setting.tmp.parentDirectory = this.parentDirectory;
            this.setting.save();

            this.$nextTick(async () => {
                await Util.sleep(100);
                // dialog close アニメーションが終わったら要素を削除する
                this.isRemove = true;
                this.$nextTick(() => {
                    this.isRemove = false;
                });
            });
        }
    }
}

export default toNative(RecordedMultipleEncodeDialog);
</script>

<style lang="sass" scoped>
.multiple-encode
    .source
        flex-basis: 35%
    .preset
        flex-basis: 65%

    @media screen and (min-width: 400px)
        .directory
            display: flex
            align-items: center
        .parent
            flex-basis: 35%
        .sub
            flex-basis: 65%
</style>

<style lang="sass">
.multiple-encode
    .v-input__control
        .v-input__slot
            margin: 0 !important
        .v-messages
            display: none
</style>
