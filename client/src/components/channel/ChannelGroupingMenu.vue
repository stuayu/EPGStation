<template>
    <div class="channel-grouping-menu">
        <v-menu class="menu" v-model="isOpened" location="bottom end">
            <template v-slot:activator="{ props }">
                <v-btn icon variant="text" size="small" class="menu-button" v-bind="props">
                    <v-icon>mdi-dots-vertical</v-icon>
                </v-btn>
            </template>
            <v-list>
                <v-list-subheader>放送局のまとめ方</v-list-subheader>
                <v-list-item v-on:click="setGroupingType('region')" slim>
                    <template #prepend>
                        <v-icon>{{ groupingType === 'region' ? 'mdi-check' : 'mdi-map-marker' }}</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>地域別</v-list-item-title>
                    </div>
                </v-list-item>
                <v-list-item v-on:click="setGroupingType('affiliation')" slim>
                    <template #prepend>
                        <v-icon>{{ groupingType === 'affiliation' ? 'mdi-check' : 'mdi-television-classic' }}</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>系列別</v-list-item-title>
                    </div>
                </v-list-item>
            </v-list>
        </v-menu>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import INavigationState from '@/model/state/navigation/INavigationState';
import {
    ChannelGroupingType,
    ISettingStorageModel,
    ISettingValue,
} from '@/model/storage/setting/ISettingStorageModel';
import { Component, Emit, Vue, toNative } from 'vue-facing-decorator';

/**
 * 番組表・放映中で地上波系の放送局をまとめる軸 (地域別 / 系列別) を切り替えるメニュー
 * 設定は共通のため、どちらの画面から変更しても両方に反映される
 */
@Component({})
class ChannelGroupingMenu extends Vue {
    public isOpened: boolean = false;

    private settingStorageModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private navigationState: INavigationState = container.get<INavigationState>('INavigationState');
    private settingValue: ISettingValue = this.settingStorageModel.getSavedValue();

    get groupingType(): ChannelGroupingType {
        return this.settingValue.channelGroupingType ?? 'region';
    }

    public setGroupingType(type: ChannelGroupingType): void {
        this.isOpened = false;
        if (this.groupingType === type) {
            return;
        }

        this.settingValue.channelGroupingType = type;
        this.settingStorageModel.save();

        // サイドメニューの番組表リンクも新しい軸で作り直す
        this.navigationState.updateItems(this.$route);
        this.onChanged();
    }

    @Emit('changed')
    public onChanged(): void {}
}

export default toNative(ChannelGroupingMenu);
</script>
