<template>
    <v-dialog v-model="isOpened" max-width="900" scrollable>
        <v-card>
            <v-card-title>ファイルを取り込む</v-card-title>
            <v-tabs v-model="tab" density="compact">
                <v-tab value="upload">アップロード</v-tab>
                <v-tab v-if="uploadState.isExternalImportEnabled() === true" value="local">サーバー上のファイル</v-tab>
            </v-tabs>
            <v-divider></v-divider>
            <v-card-text class="pa-0">
                <v-window v-model="tab">
                    <v-window-item value="upload">
                        <div class="text-caption text-grey pa-4 pb-0">
                            手元のファイルをサーバーへ送って登録します。TS ファイルは取り込み後に PSI/SI と ffprobe を解析して、放送局・番組情報・実尺を保存します。
                        </div>
                        <RecordedUploadFields></RecordedUploadFields>
                    </v-window-item>
                    <v-window-item value="local">
                        <div class="text-caption text-grey pa-4 pb-0">
                            サーバー上のディレクトリを走査して取り込みます。取り込めるのは
                            <code>config.yml</code>
                            の <code>importDirs</code> に登録したディレクトリの配下だけです。
                        </div>
                        <RecordedImportFields
                            v-on:scanImport="scanImport"
                            v-on:startImportRegistration="startImportRegistration"
                            v-on:retryFailedImports="retryFailedImports"
                        ></RecordedImportFields>
                    </v-window-item>
                </v-window>
            </v-card-text>
            <v-divider></v-divider>
            <v-card-actions>
                <v-btn variant="text" color="error" v-on:click="reset">リセット</v-btn>
                <v-spacer></v-spacer>
                <v-btn variant="text" v-on:click="close">閉じる</v-btn>
                <v-btn v-if="tab === 'upload'" color="primary" variant="text" :loading="isUploading" v-on:click="upload">
                    アップロード
                </v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import RecordedImportFields from '@/components/recorded/upload/RecordedImportFields.vue';
import RecordedUploadFields from '@/components/recorded/upload/RecordedUploadFields.vue';
import container from '@/model/ModelContainer';
import IRecordedUploadState from '@/model/state/recorded/upload/IRecordedUploadState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';

/**
 * 録画済み画面から開く取り込みダイアログ
 * アップロードとサーバー上のファイルの取り込みを 1 か所で行う
 */
@Component({
    components: {
        RecordedUploadFields,
        RecordedImportFields,
    },
})
class RecordedImportDialog extends Vue {
    @Prop({ required: true })
    public isOpen!: boolean;

    public tab: string = 'upload';
    public isUploading: boolean = false;
    public uploadState: IRecordedUploadState = container.get<IRecordedUploadState>('IRecordedUploadState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    get isOpened(): boolean {
        return this.isOpen;
    }
    set isOpened(value: boolean) {
        this.$emit('update:isOpen', value);
    }

    @Watch('isOpen', { immediate: true })
    public onChangeOpenState(newState: boolean): void {
        if (newState === true) {
            this.reset();
        }
    }

    public reset(): void {
        this.uploadState.init();

        // 日時ピッカーは再生成しないと初期値が反映されない
        this.uploadState.isShowPeriod = false;
        this.$nextTick(() => {
            this.uploadState.isShowPeriod = true;
        });
    }

    public close(): void {
        this.isOpened = false;
    }

    public async upload(): Promise<void> {
        if (this.uploadState.checkInput() === false) {
            this.snackbarState.open({ color: 'error', text: '入力内容に問題があります。' });

            return;
        }

        this.isUploading = true;
        try {
            await this.uploadState.upload();
            this.snackbarState.open({ color: 'success', text: 'アップロード完了' });
            this.close();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'アップロードに失敗' });
        } finally {
            this.isUploading = false;
        }
    }

    public async scanImport(): Promise<void> {
        try {
            await this.uploadState.scanImportDirectory();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '取り込み候補のスキャンに失敗' });
        }
    }

    public async startImportRegistration(): Promise<void> {
        try {
            await this.uploadState.startImportRegistration();
            this.snackbarState.open({ color: 'success', text: '取り込みを開始しました' });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '取り込みの開始に失敗' });
        }
    }

    public async retryFailedImports(): Promise<void> {
        try {
            await this.uploadState.retryFailedImports();
            this.snackbarState.open({ color: 'success', text: '失敗分の再実行を開始しました' });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '再実行の開始に失敗' });
        }
    }
}

export default toNative(RecordedImportDialog);
</script>
