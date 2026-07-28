<template>
    <div v-if="isEnabled === true">
        <!-- 更新のお知らせ。プレリリース (rc / beta) は色を変えて正式リリースと区別する -->
        <teleport to="body">
            <transition name="update-toast">
                <div v-if="isShowToast === true" class="update-toast-wrap">
                    <v-alert
                        :type="isPrerelease === true ? 'warning' : 'info'"
                        :color="isPrerelease === true ? 'deep-purple' : 'primary'"
                        variant="elevated"
                        density="comfortable"
                        closable
                        class="update-toast"
                        role="status"
                        @click:close="closeToast"
                    >
                        <div class="font-weight-medium">
                            {{ isPrerelease === true ? 'プレリリース版が公開されています' : '新しいバージョンが公開されています' }}
                        </div>
                        <div class="text-body-2 mt-1">{{ status?.currentVersion }} → {{ release?.tag }}</div>
                        <div class="d-flex ga-2 mt-2">
                            <v-btn size="small" variant="flat" color="white" class="text-black" @click="isOpenDialog = true">
                                詳細を見る
                            </v-btn>
                        </div>
                    </v-alert>
                </div>
            </transition>
        </teleport>

        <v-dialog v-model="isOpenDialog" max-width="760" scrollable>
            <v-card>
                <v-card-title>EPGStation の更新</v-card-title>
                <v-card-text>
                    <UpdatePanel></UpdatePanel>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="isOpenDialog = false">閉じる</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts">
import UpdatePanel from '@/components/update/UpdatePanel.vue';
import container from '@/model/ModelContainer';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import IUpdateApiModel, { UpdateReleaseInfo, UpdateStatus } from '@/model/api/update/IUpdateApiModel';
import { isFeatureEnabled } from '@/util/FeatureFlags';
import { Component, Vue, toNative } from 'vue-facing-decorator';

/**
 * 新しいバージョンの公開を知らせるトースト。
 * 実際の更新操作は UpdatePanel (サーバー設定の「更新」タブと共通) に任せる
 */
@Component({ components: { UpdatePanel } })
class UpdateNotification extends Vue {
    // 「閉じる」で見送ったバージョンを覚えておく localStorage キー
    private static readonly DISMISSED_KEY = 'update-dismissed-tag';

    status: UpdateStatus | null = null;
    isOpenDialog = false;
    dismissedTag: string | null = null;

    private api = container.get<IUpdateApiModel>('IUpdateApiModel');
    private serverConfigModel = container.get<IServerConfigModel>('IServerConfigModel');

    get isEnabled(): boolean {
        return isFeatureEnabled(this.serverConfigModel.getConfig(), 'updateNotification');
    }
    get release(): UpdateReleaseInfo | null {
        return this.status?.availableRelease ?? null;
    }
    get isPrerelease(): boolean {
        return this.status?.availableChannel === 'prerelease';
    }
    get isShowToast(): boolean {
        if (this.release === null || this.isOpenDialog === true) return false;
        // 更新中・更新後は通知ではなくダイアログ側で状況を見せる
        if (this.status !== null && this.status.job.status !== 'idle') return false;
        return this.dismissedTag !== this.release.tag;
    }

    mounted(): void {
        if (this.isEnabled === false) return;
        try {
            this.dismissedTag = window.localStorage.getItem(UpdateNotification.DISMISSED_KEY);
        } catch (err) {
            // プライベートモード等で読めなくても通知自体は出せるので無視する
            console.error(err);
        }
        void this.load();
    }

    async load(): Promise<void> {
        try {
            this.status = await this.api.getStatus();
        } catch (err) {
            // 更新チェックは補助機能なので、失敗しても他の画面表示を妨げない
            console.error(err);
        }
    }

    /**
     * 通知を閉じたバージョンは記録して、次に新しい版が出るまで再表示しない
     */
    closeToast(): void {
        if (this.release === null) return;
        this.dismissedTag = this.release.tag;
        try {
            window.localStorage.setItem(UpdateNotification.DISMISSED_KEY, this.release.tag);
        } catch (err) {
            console.error(err);
        }
    }
}

export default toNative(UpdateNotification);
</script>

<style lang="sass" scoped>
// Mirakurun の警告トーストと同じく、レイアウトを押し下げない右上のポップアップにする
.update-toast-wrap
    position: fixed
    top: 12px
    right: 12px
    z-index: 2390
    max-width: min(420px, calc(100vw - 24px))
    pointer-events: none

    .update-toast
        pointer-events: auto

@media screen and (max-width: 600px)
    .update-toast-wrap
        top: 8px
        right: 8px
        left: 8px
        max-width: none

.update-toast-enter-active, .update-toast-leave-active
    transition: opacity .2s ease, transform .2s ease

.update-toast-enter-from, .update-toast-leave-to
    opacity: 0
    transform: translateY(-8px)
</style>
