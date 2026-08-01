<template>
    <div class="recorded-main-menu">
        <v-menu class="menu" v-model="isOpened" location="bottom start">
            <template v-slot:activator="{ props }">
                <v-btn icon variant="text" size="small" class="menu-button" v-bind="props">
                    <v-icon>mdi-dots-vertical</v-icon>
                </v-btn>
            </template>
            <v-list>
                <v-list-item v-on:click="edit" slim>
                    <template #prepend>
                        <v-icon>mdi-pencil</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>編集</v-list-item-title>
                    </div>
                </v-list-item>

                <v-list-item v-on:click="cleanup" slim>
                    <template #prepend>
                        <v-icon>mdi-delete</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>クリーンアップ</v-list-item-title>
                    </div>
                </v-list-item>

                <v-list-item v-on:click="importFile" slim>
                    <template #prepend>
                        <v-icon>mdi-file-import</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>ファイルを取り込む</v-list-item-title>
                    </div>
                </v-list-item>

                <v-list-item v-on:click="upload" slim>
                    <template #prepend>
                        <v-icon>mdi-upload</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>アップロード画面へ</v-list-item-title>
                    </div>
                </v-list-item>

                <v-divider></v-divider>
                <v-list-subheader>タイトルの表示</v-list-subheader>
                <v-list-item v-on:click="setUseDictionaryEpisodeTitle(true)" slim>
                    <template #prepend>
                        <v-icon>{{ useDictionaryEpisodeTitle === true ? 'mdi-check' : 'mdi-book-open-variant' }}</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>作品名 + 話数で表示</v-list-item-title>
                    </div>
                </v-list-item>
                <v-list-item v-on:click="setUseDictionaryEpisodeTitle(false)" slim>
                    <template #prepend>
                        <v-icon>{{ useDictionaryEpisodeTitle === false ? 'mdi-check' : 'mdi-file-document-outline' }}</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>録画タイトルで表示</v-list-item-title>
                    </div>
                </v-list-item>
            </v-list>
        </v-menu>
        <div v-if="isOpened === true" class="menu-background" v-on:click="onClickMenuBackground"></div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import { ISettingStorageModel, ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import Util from '@/util/Util';
import { Component, Emit, Vue, toNative } from 'vue-facing-decorator';

@Component({})
class RecordedMainMenu extends Vue {
    public isOpened: boolean = false;

    private settingStorageModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    // save() が書き出すのは tmp なので、getSavedValue() の戻り値ではなく tmp を直接書き換える
    private settingValue: ISettingValue = this.settingStorageModel.tmp;

    get useDictionaryEpisodeTitle(): boolean {
        return this.settingValue.useDictionaryEpisodeTitle ?? true;
    }

    /**
     * 一覧のタイトル表示を「作品名 + 話数」/「録画タイトル」で切り替える。
     * 設定はシリーズ詳細と共通なので、どちらから変更しても全画面に反映される
     * @param value: boolean
     */
    public setUseDictionaryEpisodeTitle(value: boolean): void {
        this.isOpened = false;
        if (this.useDictionaryEpisodeTitle === value) {
            return;
        }

        this.settingValue.useDictionaryEpisodeTitle = value;
        this.settingStorageModel.save();

        this.onChangedTitleDisplay();
    }

    @Emit('changedTitleDisplay')
    public onChangedTitleDisplay(): void {}

    public edit(): void {
        this.$emit('edit');
    }

    public cleanup(): void {
        this.$emit('cleanup');
    }

    /**
     * その場で取り込みダイアログを開く (画面遷移しない)
     */
    public importFile(): void {
        this.$emit('import');
    }

    public async upload(): Promise<void> {
        await Util.sleep(200);
        await Util.move(this.$router, {
            path: '/recorded/upload',
        });
    }

    public onClickMenuBackground(e: Event): boolean {
        e.stopPropagation();

        return false;
    }
}

export default toNative(RecordedMainMenu);
</script>
