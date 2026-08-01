<template>
    <div class="series-title-display-menu">
        <v-menu class="menu" v-model="isOpened" location="bottom end">
            <template v-slot:activator="{ props }">
                <v-btn icon variant="text" size="small" class="menu-button" v-bind="props">
                    <v-icon>mdi-dots-vertical</v-icon>
                </v-btn>
            </template>
            <v-list>
                <v-list-subheader>エピソード名の表示</v-list-subheader>
                <v-list-item v-on:click="setUseDictionaryEpisodeTitle(true)" slim>
                    <template #prepend>
                        <v-icon>{{ useDictionaryEpisodeTitle === true ? 'mdi-check' : 'mdi-book-open-variant' }}</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>辞書のエピソード名を使う</v-list-item-title>
                    </div>
                </v-list-item>
                <v-list-item v-on:click="setUseDictionaryEpisodeTitle(false)" slim>
                    <template #prepend>
                        <v-icon>{{ useDictionaryEpisodeTitle === false ? 'mdi-check' : 'mdi-file-document-outline' }}</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>録画タイトルを使う</v-list-item-title>
                    </div>
                </v-list-item>
            </v-list>
        </v-menu>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import { ISettingStorageModel, ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import { Component, Emit, Vue, toNative } from 'vue-facing-decorator';

/**
 * シリーズ詳細のエピソード行タイトルを、作品辞書 (しょぼいカレンダー) 由来のエピソード名で表示するか
 * 録画タイトルそのままで表示するかを切り替えるメニュー
 * 設定は共通のため、どちらの画面から変更しても両方に反映される
 */
@Component({})
class SeriesTitleDisplayMenu extends Vue {
    public isOpened: boolean = false;

    private settingStorageModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    // save() が書き出すのは tmp なので、getSavedValue() の戻り値ではなく tmp を直接書き換える
    // (getSavedValue() は localStorage を読み直した別オブジェクトを返すため、変更が保存されない)
    private settingValue: ISettingValue = this.settingStorageModel.tmp;

    get useDictionaryEpisodeTitle(): boolean {
        return this.settingValue.useDictionaryEpisodeTitle ?? true;
    }

    public setUseDictionaryEpisodeTitle(value: boolean): void {
        this.isOpened = false;
        if (this.useDictionaryEpisodeTitle === value) {
            return;
        }

        this.settingValue.useDictionaryEpisodeTitle = value;
        this.settingStorageModel.save();

        this.onChanged();
    }

    @Emit('changed')
    public onChanged(): void {}
}

export default toNative(SeriesTitleDisplayMenu);
</script>
