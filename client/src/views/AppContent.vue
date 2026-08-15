<template>
    <v-app class="app-content-root">
        <div v-if="isDisconnected === true" class="disconnected"></div>
        <Navigation></Navigation>
        <ServerStatusToast></ServerStatusToast>
        <UpdateNotification></UpdateNotification>
        <router-view></router-view>
        <Snackbar></Snackbar>
    </v-app>
</template>

<script lang="ts">
import Navigation from '@/components/navigation/Navigation.vue';
import ServerStatusToast from '@/components/serverStatus/ServerStatusToast.vue';
import UpdateNotification from '@/components/update/UpdateNotification.vue';
import Snackbar from '@/components/snackbar/Snackbar.vue';
import container from '@/model/ModelContainer';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IServerStatusState from '@/model/state/serverStatus/IServerStatusState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Container } from 'inversify';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';
import ISocketIOModel from '../model/socketio/ISocketIOModel';
import IColorThemeState from '@/model/state/IColorThemeState';
import ThemeColorUtil from '@/util/ThemeColorUtil';

@Component({
    components: {
        Navigation,
        Snackbar,
        ServerStatusToast,
        UpdateNotification,
    },
})
class AppContent extends Vue {
    public isDisconnected: boolean = false;
    // 接続失敗の通知は繰り返さない (socket.io は再接続を試み続けるため)
    private hasNotifiedConnectError: boolean = false;
    private connectErrorTimerId: number | null = null;

    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private colorThemeState: IColorThemeState = container.get<IColorThemeState>('IColorThemeState');
    private serverStatusState: IServerStatusState = container.get<IServerStatusState>('IServerStatusState');

    public async created(): Promise<void> {
        // theme 設定を反映
        ThemeColorUtil.apply(this.$vuetify.theme, this.colorThemeState.getThemeColor());
        this.$vuetify.theme.change((this.colorThemeState.isDarkTheme()) ? 'dark' : 'light');

        // socket.io 設定
        try {
            this.socketIoModel.Iinitialize();
            this.setSocketIO();
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: '設定ダウンロードに失敗しました',
                timeout: 5000,
            });
        }

        // mirakurun 接続状態確認
        this.serverStatusState.fetch();
        this.serverStatusState.startPolling();
    }

    /**
     * Sokcet,IO 設定
     */
    private setSocketIO(): void {
        const io = this.socketIoModel.getIO();

        if (io === null) {
            this.snackbarState.open({
                color: 'error',
                text: 'SocketIO の初期設定に失敗しました',
            });

            return;
        }

        // イベント設定
        // 接続先の候補を切り替えると socket インスタンスが作り直されるため、
        // io へ直接ではなくモデル経由で購読する
        this.socketIoModel.onDisconnect(this.onDisconnect);
        this.socketIoModel.onConnect(this.onReconnect);
        this.socketIoModel.onConnectError(this.onConnectError);
    }

    /**
     * socketIO 接続失敗時。
     * 接続できないと画面が自動更新されなくなるため、黙って失敗させず一度だけ知らせる。
     * ただし別の接続先候補へ切り替えて復旧することがあるので、
     * しばらく待っても繋がらないときだけ知らせる
     */
    private onConnectError(): void {
        if (this.hasNotifiedConnectError === true || this.connectErrorTimerId !== null) {
            return;
        }

        this.connectErrorTimerId = window.setTimeout(() => {
            this.connectErrorTimerId = null;
            if (this.socketIoModel.isConnected() === true) {
                return;
            }
            this.hasNotifiedConnectError = true;

            this.snackbarState.open({
                color: 'error',
                text: 'サーバとの接続に失敗しました。画面が自動更新されません',
                timeout: 10000,
            });
        }, AppContent.CONNECT_ERROR_NOTIFY_DELAY);
    }

    /**
     * socketIO 切断時
     */
    private onDisconnect(): void {
        this.isDisconnected = true;

        this.$nextTick(() => {
            this.snackbarState.open({
                color: 'error',
                text: '接続が切断されました',
            });
        });
    }

    /**
     * socketIO 再接続時
     */
    private onReconnect(): void {
        // 繋がったので接続失敗の通知は取りやめる
        if (this.connectErrorTimerId !== null) {
            window.clearTimeout(this.connectErrorTimerId);
            this.connectErrorTimerId = null;
        }

        if (this.isDisconnected === false) {
            return;
        }

        this.isDisconnected = false;

        // reload
        const fullPath = this.$route.fullPath;
        this.$router.replace('/');
        this.$nextTick(() => {
            this.$router.replace(fullPath);

            this.$nextTick(() => {
                this.snackbarState.open({
                    text: '再接続されました',
                });
            });
        });
    }

    public unmounted(): void {
        this.serverStatusState.stopPolling();

        if (this.connectErrorTimerId !== null) {
            window.clearTimeout(this.connectErrorTimerId);
            this.connectErrorTimerId = null;
        }

        if (this.socketIoModel.getIO() === null) {
            return;
        }

        // イベント削除
        this.socketIoModel.offDisconnect(this.onDisconnect);
        this.socketIoModel.offConnect(this.onReconnect);
        this.socketIoModel.offConnectError(this.onConnectError);
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.snackbarState.close();
        this.scrollState.updateHistoryPosition();
    }
}

namespace AppContent {
    // 接続失敗を知らせるまでの猶予 (ms)。別の接続先候補への切り替えを待つ
    export const CONNECT_ERROR_NOTIFY_DELAY = 8000;
}

export default toNative(AppContent);
</script>

<style lang="sass" scoped>
.app-content-root
    .app-content
        margin: 0
        overflow-y: auto

    .disconnected
        position: fixed
        height: 100%
        width: 100%
        background: rgb(0, 0, 0, 0.6)
        background-attachment: fixed
        z-index: 1000
</style>
