<template>
    <teleport to="body">
        <transition name="server-status-toast">
            <div v-if="isShow === true" class="server-status-toast-wrap">
                <v-alert
                    type="error"
                    variant="elevated"
                    density="comfortable"
                    closable
                    class="server-status-toast"
                    role="alert"
                    aria-live="assertive"
                    @click:close="onClose"
                >
                    <div class="font-weight-medium">Mirakurun (チューナーサーバ) に接続できません</div>
                    <div class="text-body-2 mt-1">ライブ視聴・番組表の更新・録画は利用できません。</div>
                    <ul class="text-body-2 mt-2 solution">
                        <li>Mirakurun サービスが起動しているか確認してください</li>
                        <li>config.yml の mirakurunPath の設定を確認してください</li>
                    </ul>
                </v-alert>
            </div>
        </transition>
    </teleport>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IServerStatusState from '@/model/state/serverStatus/IServerStatusState';
import { Component, Vue, toNative } from 'vue-facing-decorator';

@Component({})
class ServerStatusToast extends Vue {
    private serverStatusState: IServerStatusState = container.get<IServerStatusState>('IServerStatusState');

    get isShow(): boolean {
        return this.serverStatusState.isMirakurunAlive === false && this.serverStatusState.isBannerClosed === false;
    }

    public onClose(): void {
        this.serverStatusState.closeBanner();
    }
}

export default toNative(ServerStatusToast);
</script>

<style lang="sass" scoped>
// 一般的な Web サイトと同様に、ページのレイアウトを押し下げない右上のポップアップとして表示する
.server-status-toast-wrap
    position: fixed
    top: 12px
    right: 12px
    z-index: 2400
    max-width: min(420px, calc(100vw - 24px))
    pointer-events: none

    .server-status-toast
        pointer-events: auto

    .solution
        padding-left: 1.2em

// スマホでは画面幅いっぱいに広げる
@media screen and (max-width: 600px)
    .server-status-toast-wrap
        top: 8px
        right: 8px
        left: 8px
        max-width: none

/**
  * 表示アニメーション
  */
.server-status-toast-enter-active, .server-status-toast-leave-active
    transition: opacity .2s ease, transform .2s ease

.server-status-toast-enter-from, .server-status-toast-leave-to
    opacity: 0
    transform: translateY(-8px)
</style>
