<template>
    <v-main>
        <TitleBar title="アップロード"></TitleBar>
        <transition name="page">
            <v-container>
                <RecordedUploadForm
                    v-on:reset="reset"
                    v-on:upload="upload"
                    v-on:scanImport="scanImport"
                    v-on:startImportRegistration="startImportRegistration"
                    v-on:retryFailedImports="retryFailedImports"
                ></RecordedUploadForm>
                <v-btn v-on:click="addVideoFile" icon size="large" class="position-fixed right-0 bottom-0 ma-4" color="pink">
                    <v-icon>mdi-plus</v-icon>
                </v-btn>
                <div style="visibility: hidden">dummy</div>
            </v-container>
        </transition>
        <RecordedUploadingDialog v-model:isOpen="isUploading"></RecordedUploadingDialog>
    </v-main>
</template>

<script lang="ts">
import RecordedUploadForm from '@/components/recorded/upload/RecordedUploadForm.vue';
import RecordedUploadingDialog from '@/components/recorded/upload/RecordedUploadingDialog.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IRecordedUploadState from '@/model/state/recorded/upload/IRecordedUploadState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';
import type { RouteLocationNormalized as Route } from 'vue-router';

@Component({
    components: {
        TitleBar,
        RecordedUploadForm,
        RecordedUploadingDialog,
    },
})
class RecordedUpload extends Vue {
    public isUploading: boolean = false;

    private uploadState: IRecordedUploadState = container.get<IRecordedUploadState>('IRecordedUploadState');
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    public reset(): void {
        this.uploadState.init();

        this.uploadState.isShowPeriod = false;
        this.$nextTick(() => {
            this.uploadState.isShowPeriod = true;
        });
    }

    public async upload(): Promise<void> {
        if (this.uploadState.checkInput() === false) {
            this.snackbarState.open({
                color: 'error',
                text: '入力内容に問題があります。',
            });

            return;
        }

        this.isUploading = true;
        try {
            await this.uploadState.upload();
            this.snackbarState.open({
                color: 'success',
                text: 'アップロード完了',
            });
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: 'アップロードに失敗',
            });
            console.error(err);
        }
        this.isUploading = false;
    }

    public addVideoFile(): void {
        this.uploadState.addEmptyVideoFileItem();
    }

    public async scanImport(): Promise<void> {
        try {
            await this.uploadState.scanImportDirectory();
            if (this.uploadState.importScanResults.length === 0) {
                this.snackbarState.open({ color: 'info', text: '取り込み候補が見つかりませんでした' });
            }
        } catch (err) {
            this.snackbarState.open({ color: 'error', text: 'スキャンに失敗' });
            console.error(err);
        }
    }

    public async startImportRegistration(): Promise<void> {
        try {
            await this.uploadState.startImportRegistration();
            this.snackbarState.open({ color: 'success', text: '取り込みを開始しました' });
        } catch (err) {
            this.snackbarState.open({ color: 'error', text: '取り込みの開始に失敗' });
            console.error(err);
        }
    }

    public async retryFailedImports(): Promise<void> {
        try {
            await this.uploadState.retryFailedImports();
        } catch (err) {
            this.snackbarState.open({ color: 'error', text: '再実行に失敗' });
            console.error(err);
        }
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.uploadState.init();
        this.$nextTick(async () => {
            await this.uploadState.fetchData().catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: 'ルール情報取得に失敗',
                });
                console.error(err);
            });

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }
}

export default toNative(RecordedUpload);
</script>
