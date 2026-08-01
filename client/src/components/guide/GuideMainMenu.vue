<template>
    <div class="reserves-main-menu">
        <v-menu class="menu" v-model="isOpened" location="bottom start">
            <template v-slot:activator="{ props }">
                <v-btn icon variant="text" size="small" class="menu-button" v-bind="props">
                    <v-icon>mdi-dots-vertical</v-icon>
                </v-btn>
            </template>
            <v-list>
                <v-list-item v-on:click="updateReserves" slim>
                    <template #prepend>
                        <v-icon>mdi-update</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>予約情報更新</v-list-item-title>
                    </div>
                </v-list-item>
                <v-list-item v-on:click="genreSetting" slim>
                    <template #prepend>
                        <v-icon>mdi-bookmark</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>表示ジャンル</v-list-item-title>
                    </div>
                </v-list-item>

                <v-divider></v-divider>
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
                <v-divider></v-divider>

                <v-list-item v-on:click="gotoSetting" slim>
                    <template #prepend>
                        <v-icon>mdi-cog</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>表示設定</v-list-item-title>
                    </div>
                </v-list-item>
            </v-list>
        </v-menu>
        <GuideGenreSettingDialog v-model:isOpen="isOpenGenreSettingDialog" v-on:update="onUpdateGenreSetting"></GuideGenreSettingDialog>
        <div v-if="isOpened === true" class="menu-background" v-on:click="onClickMenuBackground"></div>
    </div>
</template>

<script lang="ts">
import GuideGenreSettingDialog from '@/components/guide/GuideGenreSettingDialog.vue';
import IReservesApiModel from '@/model/api/reserves/IReservesApiModel';
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { ChannelGroupingType, ISettingStorageModel, ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import Util from '@/util/Util';
import { Component, Vue, toNative } from 'vue-facing-decorator';

@Component({
    components: {
        GuideGenreSettingDialog,
    },
})
class GuideMainMenu extends Vue {
    public isOpened: boolean = false;
    public isOpenGenreSettingDialog: boolean = false;

    private reservesApiModel: IReservesApiModel = container.get<IReservesApiModel>('IReservesApiModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private settingStorageModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private settingValue: ISettingValue = this.settingStorageModel.getSavedValue();

    get groupingType(): ChannelGroupingType {
        return this.settingValue.channelGroupingType ?? 'region';
    }

    /**
     * 地上波系のまとめ方 (地域別 / 系列別) を切り替える
     * @param type: ChannelGroupingType
     */
    public setGroupingType(type: ChannelGroupingType): void {
        this.isOpened = false;
        if (this.groupingType === type) {
            return;
        }

        this.settingValue.channelGroupingType = type;
        this.settingStorageModel.save();
        this.$emit('changedgrouping');
    }

    public async updateReserves(): Promise<void> {
        this.isOpened = false;

        try {
            await this.reservesApiModel.updateAll();
            this.snackbarState.open({
                text: '予約情報の更新開始',
            });
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: '予約情報の更新を開始できませんでした。',
            });
        }
    }

    public async genreSetting(): Promise<void> {
        this.isOpened = false;
        await Util.sleep(300);
        this.isOpenGenreSettingDialog = true;
    }

    public onUpdateGenreSetting(): void {
        this.$emit('updatedgenre');
    }

    public async gotoSetting(): Promise<void> {
        await Util.move(this.$router, {
            path: '/guide/setting',
        });
    }

    public onClickMenuBackground(e: Event): boolean {
        e.stopPropagation();

        return false;
    }
}

export default toNative(GuideMainMenu);
</script>
