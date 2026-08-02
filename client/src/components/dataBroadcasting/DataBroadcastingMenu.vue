<template>
    <div class="data-broadcasting-menu">
        <v-menu class="menu" v-model="isOpened" location="bottom end">
            <template v-slot:activator="{ props }">
                <v-btn icon variant="text" size="small" class="menu-button" v-bind="props">
                    <v-icon>mdi-dots-vertical</v-icon>
                </v-btn>
            </template>
            <v-list>
                <v-list-subheader>データ放送</v-list-subheader>
                <v-list-item v-on:click="setEnabled(true)" slim>
                    <template #prepend>
                        <v-icon>{{ isEnabled === true ? 'mdi-check' : 'mdi-television-classic' }}</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>表示する</v-list-item-title>
                    </div>
                </v-list-item>
                <v-list-item v-on:click="setEnabled(false)" slim>
                    <template #prepend>
                        <v-icon>{{ isEnabled === false ? 'mdi-check' : 'mdi-television-off' }}</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>表示しない</v-list-item-title>
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
 * 視聴画面でデータ放送 (BML) レイヤーを表示するかどうかを切り替えるメニュー。
 * ON/OFF は localStorage (ISettingStorageModel.isEnableDataBroadcasting) に保存され、次回以降の視聴にも引き継がれる
 */
@Component({})
class DataBroadcastingMenu extends Vue {
    public isOpened: boolean = false;

    private settingStorageModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    // save() が書き出すのは tmp なので、getSavedValue() の戻り値ではなく tmp を直接書き換える
    private settingValue: ISettingValue = this.settingStorageModel.tmp;

    get isEnabled(): boolean {
        return this.settingValue.isEnableDataBroadcasting;
    }

    public setEnabled(value: boolean): void {
        this.isOpened = false;
        if (this.isEnabled === value) return;

        this.settingValue.isEnableDataBroadcasting = value;
        this.settingStorageModel.save();

        this.onChanged(value);
    }

    @Emit('changed')
    public onChanged(value: boolean): boolean {
        return value;
    }
}

export default toNative(DataBroadcastingMenu);
</script>
