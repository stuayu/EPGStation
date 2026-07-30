<template>
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
</template>

<script lang="ts">
import SearchOptionRow from '@/components/search/SearchOptionRow.vue';
import container from '@/model/ModelContainer';
import IRecordedUploadState from '@/model/state/recorded/upload/IRecordedUploadState';
import { Component, Vue, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../../api';

/**
 * 外部録画ファイル (EDCB 等) の取り込み UI
 * 取り込み元ディレクトリの選択 → スキャン → 候補の確認・編集 → 登録 → 進捗表示
 */
@Component({
    components: {
        SearchOptionRow,
    },
})
class RecordedImportFields extends Vue {
    public uploadState: IRecordedUploadState = container.get<IRecordedUploadState>('IRecordedUploadState');

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

export default toNative(RecordedImportFields);
</script>

<style lang="sass" scoped>
.directory
    max-width: 150px

.import-field
    max-width: 220px
    margin-right: 8px

.import-row
    border-bottom: 1px solid rgba(128, 128, 128, 0.2)
</style>
