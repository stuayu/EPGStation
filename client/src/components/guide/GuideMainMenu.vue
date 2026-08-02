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
                <!-- 系列でまとめた番組表は系列局の一覧から選ぶ (メニュー内での切り替えはやめた) -->
                <v-list-item v-on:click="gotoAffiliations" slim>
                    <template #prepend>
                        <v-icon>mdi-television-classic</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>系列局から選ぶ</v-list-item-title>
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

    /**
     * 系列局の一覧へ移動する (系列を選ぶとその系列の番組表が開く)
     */
    public async gotoAffiliations(): Promise<void> {
        this.isOpened = false;
        await Util.sleep(300);
        await Util.move(this.$router, { path: '/affiliations' });
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
