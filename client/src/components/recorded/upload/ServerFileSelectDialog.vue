<template>
    <v-dialog v-model="isOpen" max-width="800" scrollable>
        <v-card>
            <v-card-title>サーバー上のファイルを選択</v-card-title>
            <v-card-text>
                <div v-if="dirItems.length === 0" class="text-medium-emphasis">
                    config.yml の importDirs にディレクトリが設定されていないため、サーバー上のファイルを指定できません。
                </div>
                <template v-else>
                    <div class="d-flex flex-wrap ga-2">
                        <v-select v-model="dirName" :items="dirItems" label="ディレクトリ" class="dir-field" hide-details></v-select>
                        <v-text-field v-model="subPath" label="サブパス" class="sub-path-field" clearable hide-details></v-text-field>
                        <v-checkbox v-model="recursive" label="サブディレクトリも走査" hide-details></v-checkbox>
                        <v-btn v-on:click="reload" :loading="isLoading" variant="text" color="secondary" class="align-self-center">再読み込み</v-btn>
                    </div>
                    <v-divider class="my-3"></v-divider>
                    <div v-if="isLoading === false && files.length === 0" class="text-medium-emphasis">ファイルが見つかりません</div>
                    <v-list v-else density="compact">
                        <v-list-item v-for="file in files" v-bind:key="file.filePath" v-on:click="select(file)">
                            <v-list-item-title>{{ file.fileName }}</v-list-item-title>
                            <v-list-item-subtitle>{{ file.filePath }}</v-list-item-subtitle>
                            <template #append>
                                <span class="text-caption text-medium-emphasis">{{ getSizeText(file) }}</span>
                            </template>
                        </v-list-item>
                    </v-list>
                </template>
            </v-card-text>
            <v-divider></v-divider>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn v-on:click="close" variant="text">閉じる</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IRecordedUploadState, { ServerFileItem } from '@/model/state/recorded/upload/IRecordedUploadState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';

/**
 * サーバー上 (config.importDirs 配下) のファイルを選ぶダイアログ
 * 選択したファイルは `selected` イベントでファイルパスを親へ返す
 */
@Component({})
class ServerFileSelectDialog extends Vue {
    @Prop({ required: true })
    public modelValue!: boolean;

    public dirName: string | undefined;
    public subPath: string | null = null;
    public recursive: boolean = true;
    public files: ServerFileItem[] = [];
    public isLoading: boolean = false;

    private uploadState: IRecordedUploadState = container.get<IRecordedUploadState>('IRecordedUploadState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    get isOpen(): boolean {
        return this.modelValue;
    }

    set isOpen(value: boolean) {
        this.$emit('update:modelValue', value);
    }

    get dirItems(): string[] {
        return this.uploadState.getImportDirItems();
    }

    @Watch('modelValue')
    public onOpenChange(value: boolean): void {
        if (value !== true) {
            return;
        }

        if (typeof this.dirName === 'undefined') {
            this.dirName = this.dirItems[0];
        }
        void this.reload();
    }

    /**
     * 指定条件でサーバー上のファイル一覧を取得する
     */
    public async reload(): Promise<void> {
        if (typeof this.dirName !== 'string') {
            return;
        }

        this.isLoading = true;
        try {
            this.files = await this.uploadState.listServerFiles(this.dirName, this.subPath, this.recursive);
        } catch (err) {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: 'ファイル一覧の取得に失敗しました',
            });
        } finally {
            this.isLoading = false;
        }
    }

    public select(file: ServerFileItem): void {
        this.$emit('selected', file);
        this.isOpen = false;
    }

    public close(): void {
        this.isOpen = false;
    }

    public getSizeText(file: ServerFileItem): string {
        if (typeof file.size !== 'number') {
            return '';
        }

        return `${Math.round(file.size / 1024 / 1024).toLocaleString()} MB`;
    }
}

export default toNative(ServerFileSelectDialog);
</script>

<style lang="sass" scoped>
.dir-field
    max-width: 240px

.sub-path-field
    max-width: 240px
</style>
