<template>
    <v-card class="mx-auto" max-width="800">
        <div class="pa-4">
            <SearchOptionRow title="放送局※" :required="true">
                <v-select label="channel" :items="uploadState.getChannelItems()" v-model="uploadState.programOption.channelId" clearable></v-select>
            </SearchOptionRow>
            <SearchOptionRow title="ジャンル">
                <div class="d-flex">
                    <v-select label="genre" :items="uploadState.getGenreItems()" v-model="uploadState.programOption.genre1" clearable style="width: 50%"></v-select>
                    <v-select label="sub genre" :items="uploadState.getSubGenreItems()" v-model="uploadState.programOption.subGenre1" clearable style="width: 50%"></v-select>
                </div>
            </SearchOptionRow>
            <SearchOptionRow title="ルール">
                <v-autocomplete
                    v-model="uploadState.programOption.ruleId"
                    :loading="ruleLoading"
                    :items="uploadState.ruleItems"
                    v-model:search="ruleSearchInput"
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
            </SearchOptionRow>
            <SearchOptionRow title="日付※" :required="true">
                <v-datetime-picker
                    v-if="uploadState.isShowPeriod === true"
                    label="開始"
                    clearText="クリア"
                    okText="設定"
                    v-model="uploadState.programOption.startAt"
                    :datePickerProps="{
                        locale: 'jp-ja',
                        'day-format': formatDay,
                        'first-day-of-week': 1,
                    }"
                    :timePickerProps="{
                        'ampm-in-title': true,
                    }"
                    :textFieldProps="{
                        color: 'success',
                    }"
                >
                    <template #actions="{ parent }">
                        <v-btn variant="text" color="primary" @click="parent.clearHandler">クリア</v-btn>
                        <v-btn variant="text" color="primary" @click="parent.okHandler">設定</v-btn>
                    </template>
                </v-datetime-picker>
            </SearchOptionRow>
            <SearchOptionRow title="長さ※" :required="true">
                <v-text-field v-model.number="uploadState.programOption.duration" min="1" label="長さ(分)" type="number" clearable></v-text-field>
            </SearchOptionRow>
            <SearchOptionRow title="番組名※" :required="true">
                <v-text-field v-model="uploadState.programOption.name" label="name" clearable></v-text-field>
            </SearchOptionRow>
            <SearchOptionRow title="概要">
                <v-textarea label="description" v-model="uploadState.programOption.description"></v-textarea>
            </SearchOptionRow>
            <SearchOptionRow title="詳細">
                <v-textarea label="extended" v-model="uploadState.programOption.extended"></v-textarea>
            </SearchOptionRow>
            <div v-for="video in uploadState.videoFileItems" v-bind:key="video.key">
                <SearchOptionRow :title="`ビデオファイル${video.key + 1}`">
                    <v-text-field v-model="video.viewName" label="name" clearable class="view-name"></v-text-field>
                    <v-select class="file-type" v-model="video.fileType" :items="uploadState.getFileTypeItems()" label="file type"></v-select>

                    <v-select class="directory" v-model="video.parentDirectoryName" :items="uploadState.getPrentDirectoryItems()" label="directory"></v-select>
                    <v-text-field v-model="video.subDirectory" label="sub directory" clearable></v-text-field>
                    <v-file-input v-model="video.file" label="video file"></v-file-input>
                </SearchOptionRow>
            </div>
        </div>
        <div class="pa-4" v-if="uploadState.isExternalImportEnabled() === true">
            <v-divider class="mb-4"></v-divider>
            <div class="text-h6 mb-3">外部録画ファイル取り込み (EDCB 等)</div>

            <SearchOptionRow title="取り込み元ディレクトリ※" :required="true">
                <v-select v-model="uploadState.importDirName" :items="uploadState.getImportDirItems()" label="import directory"></v-select>
            </SearchOptionRow>
            <SearchOptionRow title="サブパス">
                <v-text-field v-model="uploadState.importSubPath" label="sub path" clearable></v-text-field>
            </SearchOptionRow>
            <SearchOptionRow title="サブディレクトリも走査">
                <v-checkbox v-model="uploadState.importRecursive"></v-checkbox>
            </SearchOptionRow>
            <SearchOptionRow title="登録先ディレクトリ (move モード用)">
                <v-select v-model="uploadState.importParentDirectoryName" :items="uploadState.getPrentDirectoryItems()" label="directory"></v-select>
            </SearchOptionRow>

            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn v-on:click="scanImport" :loading="uploadState.importIsScanning" variant="text" color="secondary">スキャン</v-btn>
            </v-card-actions>

            <div v-if="uploadState.importScanResults.length > 0">
                <v-divider class="mb-2"></v-divider>
                <div v-for="row in uploadState.importScanResults" v-bind:key="row.result.filePath" class="import-row pb-2 mb-2">
                    <v-checkbox v-model="row.selected" :label="row.result.fileName" hide-details></v-checkbox>
                    <!-- 番組名・放送局・時刻を何から推定したか。TS を解析できたものが最も確実 -->
                    <div class="d-flex align-center ga-1 flex-wrap mb-1">
                        <v-chip size="x-small" :color="estimatedSourceColor(row.result)" variant="flat" :title="estimatedSourceTitle(row.result)">
                            {{ estimatedSourceText(row.result) }}
                        </v-chip>
                        <span v-if="row.result.tsServiceName" class="text-caption text-grey">
                            TS: {{ row.result.tsServiceName }}<span v-if="row.result.tsServiceId"> (service id {{ row.result.tsServiceId }})</span>
                        </span>
                    </div>
                    <div class="d-flex flex-wrap">
                        <v-text-field v-model="row.editedName" label="番組名" class="import-field" clearable></v-text-field>
                        <v-select v-model="row.editedChannelId" :items="uploadState.getChannelItems()" item-title="title" item-value="value" label="放送局" class="import-field" clearable></v-select>
                        <v-select v-model="row.mode" :items="uploadState.getImportModeItems()" label="取り込みモード" class="import-field"></v-select>
                        <v-select
                            v-if="row.result.duplicateRecordedIds && row.result.duplicateRecordedIds.length > 0"
                            v-model="row.duplicateAction"
                            :items="uploadState.getImportDuplicateActionItems()"
                            label="重複時の挙動"
                            class="import-field"
                        ></v-select>
                        <span v-if="row.result.duplicateRecordedIds && row.result.duplicateRecordedIds.length > 0" class="text-warning ml-2 align-self-center">重複の可能性があります</span>
                    </div>
                </div>

                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn v-on:click="startImportRegistration" variant="text" color="primary">選択したファイルを登録</v-btn>
                </v-card-actions>
            </div>

            <div v-if="uploadState.importJobStatus !== null" class="pa-2">
                <div>進捗: {{ uploadState.importJobStatus.done }} / {{ uploadState.importJobStatus.total }} (成功 {{ uploadState.importJobStatus.successCount }} / 失敗 {{ uploadState.importJobStatus.failedCount }})</div>
                <v-progress-linear :model-value="(uploadState.importJobStatus.done / Math.max(1, uploadState.importJobStatus.total)) * 100"></v-progress-linear>
                <v-btn v-if="uploadState.importJobStatus.isRunning === false && uploadState.importJobStatus.failedCount > 0" v-on:click="retryFailedImports" variant="text" color="error">
                    失敗分を再実行
                </v-btn>
            </div>
        </div>
        <v-divider></v-divider>
        <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn v-on:click="reset" variant="text" color="error">リセット</v-btn>
            <v-btn v-on:click="upload" variant="text" color="primary">アップロード</v-btn>
        </v-card-actions>
    </v-card>
</template>

<script lang="ts">
import SearchOptionRow from '@/components/search/SearchOptionRow.vue';
import container from '@/model/ModelContainer';
import IRecordedUploadState from '@/model/state/recorded/upload/IRecordedUploadState';
import * as apid from '../../../../../api';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';

@Component({
    components: {
        SearchOptionRow,
    },
})
class RecordedUploadForm extends Vue {
    public formatDay(date: string | number | Date): number {
        return new Date(date).getDate();
    }

    public uploadState: IRecordedUploadState = container.get<IRecordedUploadState>('IRecordedUploadState');
    public ruleLoading: boolean = false;
    public ruleSearchInput: string | undefined;

    @Watch('ruleSearchInput', { immediate: true })
    public async onChangeSearch(newKeyword: string): Promise<void> {
        if (newKeyword === null || newKeyword === this.uploadState.ruleKeyword) {
            return;
        }

        this.uploadState.ruleKeyword = newKeyword;
        await this.uploadState.updateRuleItems();
    }

    public reset(): void {
        this.$emit('reset');
    }

    public upload(): void {
        this.$emit('upload');
    }

    /**
     * 推定に使った情報源の表示テキスト
     */
    public estimatedSourceText(result: apid.ImportScanResultItem): string {
        switch (result.estimatedSource) {
            case 'ts':
                return 'TS 解析';
            case 'programTxt':
                return 'program.txt';
            default:
                return 'ファイル名';
        }
    }

    public estimatedSourceColor(result: apid.ImportScanResultItem): string {
        switch (result.estimatedSource) {
            case 'ts':
                return 'teal';
            case 'programTxt':
                return 'blue-grey';
            default:
                return 'grey';
        }
    }

    public estimatedSourceTitle(result: apid.ImportScanResultItem): string {
        switch (result.estimatedSource) {
            case 'ts':
                return 'TS の PSI/SI (SDT / EIT) から取得しました。最も確実です';
            case 'programTxt':
                return '同名の .program.txt から推定しました';
            default:
                return 'ファイル名から推定しました。誤っている場合は修正してください';
        }
    }

    public scanImport(): void {
        this.$emit('scanImport');
    }

    public startImportRegistration(): void {
        this.$emit('startImportRegistration');
    }

    public retryFailedImports(): void {
        this.$emit('retryFailedImports');
    }
}

export default toNative(RecordedUploadForm);
</script>

<style lang="sass" scoped>
.view-name, .file-type, .directory
    max-width: 150px

.import-field
    max-width: 200px
    margin-right: 8px

.import-row
    border-bottom: 1px solid rgba(128, 128, 128, 0.3)
</style>
