<template>
    <v-navigation-drawer
        v-model="navigationState.openState"
        :clipped="navigationState.isClipped"
        :permanent="navigationState.type === 'permanent'"
        :temporary="navigationState.type === 'temporary'"
        app
        overflow
    >
        <v-list-item :class="headerClass">
            <div class="v-list-item-content">
                <v-list-item-title class="title" :title="versionState.getFullVersionString()">{{
                    versionState.getVersionString()
                }}</v-list-item-title>
            </div>
        </v-list-item>

        <v-list density="compact">
            <v-list-item
                v-for="(item, index) in navigationState.items"
                :key="index"
                link
                :disabled="isItemEnabled(item) === false"
                v-on:click="route(item)"
                :active="navigationState.navigationPosition === index"
                :color="themeColorName"
            >
                <template #prepend>
                    <v-icon>{{ item.icon }}</v-icon>
                </template>

                <div class="v-list-item-content">
                    <v-list-item-title>{{ item.title }}</v-list-item-title>
                </div>
                <template v-if="isOffline === true && isItemEnabled(item) === false" #append>
                    <v-icon size="x-small" title="オフラインでは使えません">mdi-cloud-off-outline</v-icon>
                </template>
            </v-list-item>
        </v-list>
        <div class="list-dummy"></div>
    </v-navigation-drawer>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import { isOfflineStartup } from '@/util/OfflineStartup';
import { isNavigationItemEnabled } from '@/util/NavigationOfflineUtil';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import INavigationState from '@/model/state/navigation/INavigationState';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import IVersionState from '@/model/state/version/IVersionState';
import { ISettingStorageModel, ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';
import type { RouteLocationRaw as Location } from 'vue-router';
import ThemeColorUtil from '@/util/ThemeColorUtil';
import Util from '../../util/Util';

interface NavigationItem {
    title: string;
    icon: string;
    herf: Location | null;
}

@Component({})
class Navigation extends Vue {
    public navigationState: INavigationState = container.get<INavigationState>('INavigationState');

    private serverConfig: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    public versionState: IVersionState = container.get<IVersionState>('IVersionState');
    // socket.io の通知はメソッドで受ける (クラスフィールドのコールバックだと this が Vue インスタンスにならず、画面へ反映されない)
    public async onUpdateStatus(): Promise<void> {
        await this.versionState.fetchData();
    }

    // オフライン時はサーバが要る項目を押せなくする (サイドバー自体は表示し続ける)
    public isOffline: boolean = isOfflineStartup();

    public created(): void {
        this.navigationState.updateItems(this.$route);

        // リスナにはメソッドをそのまま渡す (クラスフィールドのコールバックは this が Vue インスタンスにならない)。
        // socket.io の購読より先に登録する: オフライン起動では socket.io を初期化しないため購読が失敗し得て、
        // その後ろに書くと回線が戻っても項目が押せないままになる
        window.addEventListener('online', this.onNetworkChange);
        window.addEventListener('offline', this.onNetworkChange);

        // socket.io イベント
        try {
            this.socketIoModel.onUpdateState(this.onUpdateStatus);
        } catch (err) {
            console.warn('navigation: socket.io is not initialized', err);
        }
    }

    public beforeUnmount(): void {
        window.removeEventListener('online', this.onNetworkChange);
        window.removeEventListener('offline', this.onNetworkChange);
        // socket.io イベント
        try {
            this.socketIoModel.offUpdateState(this.onUpdateStatus);
        } catch (err) {
            console.warn('navigation: socket.io is not initialized', err);
        }
    }

    public onNetworkChange(): void {
        // オフライン起動の判定 (isOfflineStartup) は起動時の状態を保持し続けるので、
        // 回線が戻ったらブラウザの状態で押せる項目を戻す
        this.isOffline = navigator.onLine === false;
    }

    /**
     * ナビゲーション項目を押せるか
     * @param item: NavigationItem
     * @return boolean
     */
    public isItemEnabled(item: NavigationItem): boolean {
        return isNavigationItemEnabled(item.herf as { path?: string } | string | null, this.isOffline);
    }

    /**
     * ドロワー先頭 (バージョン表示) の class を返す
     * title bar と揃えるため、ダークテーマでは色を敷かず既定の背景のままにする
     * @return any
     */
    get headerClass(): any {
        return this.$vuetify.theme.global.current.dark === true ? {} : { [`bg-${ThemeColorUtil.COLOR_NAME}`]: true };
    }

    /**
     * 選択中のナビゲーション項目に使う色名を返す
     * @return string
     */
    get themeColorName(): string {
        return ThemeColorUtil.COLOR_NAME;
    }

    /**
     * ナビゲーション要素クリック時に呼ばれ、ページを移動する
     * @param item: NavigationItem
     */
    public async route(item: NavigationItem): Promise<void> {
        if (item.herf === null || this.isItemEnabled(item) === false) {
            return;
        }

        // デスクトップ未満のサイズであったらナビゲーションを閉じる
        if (window.innerWidth < 1264) {
            this.navigationState.openState = false;
            await Util.sleep(200);
        }

        Util.move(this.$router, item.herf).catch(err => {
            console.error(err);
        });
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.updateSelected();

        this.$nextTick(async () => {
            // オフライン中はバージョン API を呼ばない (失敗の snackbar を出さない)
            if (this.isOffline === true) return;
            await this.versionState.fetchData().catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: 'バージョン情報取得に失敗',
                });
                console.error(err);
            });
        });
    }

    /**
     * 選択位置を更新
     */
    private updateSelected(): void {
        this.$nextTick(() => {
            this.navigationState.updateNavigationPosition(this.$route);
        });
    }
}

export default toNative(Navigation);
</script>

<style lang="sass" scoped>
.list-dummy
    margin-bottom: 16px


// iOS デバイスで一番下までスクロールできないため
.v-navigation-drawer
    height: 100% !important
</style>
