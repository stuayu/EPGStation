<template>
    <v-dialog v-model="isOpened" max-width="600" scrollable>
        <v-card v-if="recordedItem !== null">
            <v-card-title>ビデオファイルを追加</v-card-title>
            <v-card-text>
                <div class="text-body-2 mb-1">{{ recordedItem.name }}</div>
                <div class="text-caption text-medium-emphasis mb-3">この録画番組にビデオファイルを追加します。番組情報はすでに登録済みのため入力は要りません。</div>
                <v-file-input v-model="file" label="ビデオファイル" v-on:update:model-value="setViewName"></v-file-input>
                <v-text-field v-model="viewName" label="表示名" clearable></v-text-field>
                <v-select v-model="fileType" :items="fileTypeItems" label="ファイルタイプ"></v-select>
                <v-select v-model="parentDirectoryName" :items="parentDirectoryItems" label="保存先ディレクトリ"></v-select>
                <v-text-field v-model="subDirectory" label="サブディレクトリ" clearable></v-text-field>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn variant="text" :disabled="uploading === true" v-on:click="close">キャンセル</v-btn>
                <v-btn color="primary" variant="text" :loading="uploading" :disabled="canUpload === false" v-on:click="upload">アップロード</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import container from '@/model/ModelContainer';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Emit, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../../api';

/**
 * 録画詳細から開く「ビデオファイルの追加」ダイアログ
 *
 * 番組情報がすでに登録済みの録画に対して動画だけを追加する導線。
 * アップロード画面と違い番組情報の入力欄は持たない
 */
@Component({})
class RecordedUploadVideoDialog extends Vue {
    @Prop({ required: true })
    public isOpen!: boolean;

    @Prop({ required: true })
    public recordedItem!: apid.RecordedItem | null;

    public isOpened: boolean = false;
    public uploading: boolean = false;
    public file: File | null = null;
    public viewName: string | null = null;
    public fileType: apid.VideoFileType = 'encoded';
    public parentDirectoryName: string | undefined;
    public subDirectory: string | null = null;

    public readonly fileTypeItems: apid.VideoFileType[] = ['ts', 'encoded'];

    private videoApiModel = container.get<IVideoApiModel>('IVideoApiModel');
    private serverConfigModel = container.get<IServerConfigModel>('IServerConfigModel');
    private snackbarState = container.get<ISnackbarState>('ISnackbarState');

    get parentDirectoryItems(): string[] {
        const config = this.serverConfigModel.getConfig();

        return config === null ? [] : config.recorded;
    }

    get canUpload(): boolean {
        return this.file !== null && typeof this.viewName === 'string' && this.viewName.length > 0 && typeof this.parentDirectoryName === 'string';
    }

    /**
     * 表示名が未入力ならファイル名で埋める
     */
    public setViewName(): void {
        if (this.file === null) return;
        if (typeof this.viewName === 'string' && this.viewName.length > 0) return;

        this.viewName = this.file.name;
    }

    public async upload(): Promise<void> {
        if (this.canUpload === false || this.recordedItem === null) return;

        this.uploading = true;
        try {
            const option: apid.UploadVideoFileOption = {
                recordedId: this.recordedItem.id,
                parentDirectoryName: this.parentDirectoryName as string,
                viewName: this.viewName as string,
                fileType: this.fileType,
                file: this.file as File,
            };
            if (typeof this.subDirectory === 'string' && this.subDirectory.length > 0) {
                option.subDirectory = this.subDirectory;
            }

            await this.videoApiModel.uploadedVideoFile(option);
            this.snackbarState.open({ color: 'success', text: 'アップロード完了' });
            this.uploaded();
            this.close();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'アップロードに失敗' });
        } finally {
            this.uploading = false;
        }
    }

    @Emit('uploaded')
    public uploaded(): void {}

    public close(): void {
        this.isOpened = false;
    }

    @Watch('isOpen', { immediate: true })
    public onChangeIsOpen(newState: boolean): void {
        this.isOpened = newState;
        if (newState === true) {
            this.file = null;
            this.viewName = null;
            this.fileType = 'encoded';
            this.parentDirectoryName = this.parentDirectoryItems[0];
            this.subDirectory = null;
        }
    }

    @Watch('isOpened', { immediate: true })
    public onChangeIsOpened(newState: boolean): void {
        this.$emit('update:isOpen', newState);
    }
}

export default toNative(RecordedUploadVideoDialog);
</script>
