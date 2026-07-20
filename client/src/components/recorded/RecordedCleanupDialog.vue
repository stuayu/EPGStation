<template>
    <v-dialog v-if="isRemove === false" v-model="dialogModel" :persistent="isClearing" max-width="400" scrollable>
        <v-card v-if="isLoading === true">
            <v-card-text class="pa-4">
                <h3>クリーンアップ対象を確認中</h3>
                <v-progress-linear class="my-5" indeterminate rounded height="6"></v-progress-linear>
            </v-card-text>
        </v-card>
        <v-card v-else-if="isClearing === true">
            <v-card-text class="pa-4">
                <h3>クリーンアップ中</h3>
                <v-progress-linear class="my-5" indeterminate rounded height="6"></v-progress-linear>
            </v-card-text>
        </v-card>
        <v-card v-else class="recorded-cleanup-dialog">
            <v-card-text class="pa-4 pb-0">
                <v-radio-group v-model="target" hide-details class="mt-0">
                    <v-radio value="all" label="すべて削除する (録画ファイル + ログ)"></v-radio>
                    <v-radio value="dropLogOnly" label="ログのみ削除する (録画ファイルは削除しない)"></v-radio>
                </v-radio-group>

                <div class="mt-3">
                    <div v-if="target === 'all'" v-bind:class="{ 'error--text': hasVideoFiles === true }">
                        録画フォルダ内の DB 未登録ファイル
                        <strong>{{ videoFileCount }} 件</strong>
                        <span v-if="videoFileTotalSize !== ''">({{ videoFileTotalSize }})</span>
                        を
                        <strong>完全に削除します (元に戻せません)</strong>
                        。
                    </div>
                    <div v-if="videoFileSamples.length > 0" class="text-caption grey--text text--darken-1 mt-1">
                        例: {{ videoFileSamples.join(', ') }}
                        <span v-if="videoFileCount > videoFileSamples.length">, ...</span>
                    </div>

                    <div class="mt-2">
                        ドロップログファイル
                        <strong>{{ dropLogCount }} 件</strong>
                        を削除します。
                    </div>
                    <div v-if="dropLogSamples.length > 0" class="text-caption grey--text text--darken-1 mt-1">
                        例: {{ dropLogSamples.join(', ') }}
                        <span v-if="dropLogCount > dropLogSamples.length">, ...</span>
                    </div>
                </div>

                <div v-if="targetCandidateCount === 0" class="mt-4 text--secondary">削除対象はありません。</div>

                <div v-if="target === 'all' && hasVideoFiles === true" class="mt-4">
                    <v-checkbox v-model="isAgreed" color="error" hide-details class="mt-0 pt-0" label="実データが削除されることを理解しました"></v-checkbox>
                </div>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn color="primary" text v-on:click="dialogModel = false">キャンセル</v-btn>
                <v-btn color="error" text v-on:click="execute" :disabled="canExecute === false">実行</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import IThumbnailApiModel from '@/model/api/thumbnail/IThumbnailApiModel';
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({})
export default class RecordedCleanupDialog extends Vue {
    @Prop({ required: true })
    public isOpen!: boolean;

    public isRemove: boolean = false;
    public isLoading: boolean = false;
    public isClearing: boolean = false;
    public isAgreed: boolean = false;
    public target: apid.RecordedCleanupTarget = 'all';
    public info: apid.RecordedCleanupInfo | null = null;

    private recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    private thumbnailApiModel = container.get<IThumbnailApiModel>('IThumbnailApiModel');
    private snackbarState = container.get<ISnackbarState>('ISnackbarState');

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

    get hasVideoFiles(): boolean {
        return this.videoFileCount > 0;
    }

    get videoFileCount(): number {
        return this.info === null ? 0 : this.info.videoFiles.count;
    }

    get videoFileSamples(): string[] {
        return this.info === null ? [] : this.info.videoFiles.sampleFilePaths;
    }

    get videoFileTotalSize(): string {
        if (this.info === null || typeof this.info.videoFiles.totalSize === 'undefined') {
            return '';
        }

        return Util.getFileSizeStr(this.info.videoFiles.totalSize);
    }

    get dropLogCount(): number {
        return this.info === null ? 0 : this.info.dropLogs.count;
    }

    get dropLogSamples(): string[] {
        return this.info === null ? [] : this.info.dropLogs.sampleFilePaths;
    }

    /**
     * 選択中の target で実際に削除される件数
     */
    get targetCandidateCount(): number {
        if (this.info === null) {
            return 0;
        }

        return this.target === 'all' ? this.videoFileCount + this.dropLogCount : this.dropLogCount;
    }

    /**
     * 実行ボタンを有効化してよいか
     * 削除対象が 0 件の場合、および target が all で録画実ファイルが対象に含まれるのに同意チェックが入っていない場合は無効化する
     */
    get canExecute(): boolean {
        if (this.info === null || this.targetCandidateCount === 0) {
            return false;
        }

        if (this.target === 'all' && this.hasVideoFiles === true && this.isAgreed === false) {
            return false;
        }

        return true;
    }

    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === true && !!oldState === false) {
            this.init();
        } else if (newState === false && oldState === true) {
            // close
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

    /**
     * ダイアログを開いた際にクリーンアップ対象情報を取得する
     */
    private async init(): Promise<void> {
        this.target = 'all';
        this.isAgreed = false;
        this.info = null;
        this.isLoading = true;

        try {
            this.info = await this.recordedApiModel.getCleanupInfo();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: 'クリーンアップ対象の取得に失敗',
            });
            this.dialogModel = false;
        }

        this.isLoading = false;
    }

    public async execute(): Promise<void> {
        if (this.canExecute === false) {
            return;
        }

        this.isClearing = true;

        let isSuccess = false;
        const now = new Date().getTime();
        try {
            await this.recordedApiModel.cleanup(this.target);
            if (this.target === 'all') {
                // サムネイルクリーンアップは全クリーンアップ時のみ実行する
                await this.thumbnailApiModel.cleanup();
            }
            isSuccess = true;
        } catch (err) {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: 'クリーンアップに失敗',
            });
        }

        // 1秒以上はプログレスバーを表示させる
        const diff = new Date().getTime() - now;
        if (diff < 1000) {
            await Util.sleep(1000 - diff);
        }

        this.dialogModel = false;

        if (isSuccess === true) {
            this.snackbarState.open({
                color: 'success',
                text: 'クリーンアップ完了',
            });
        }

        await Util.sleep(300);
        this.isClearing = false;
    }
}
</script>
