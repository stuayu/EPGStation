<template>
    <v-alert v-if="isShow" type="error" closable prominent border="start" class="server-status-banner" @click:close="onClose">
        <div class="text">Mirakurun (チューナーサーバ) に接続できません。ライブ視聴・番組表の更新・録画は利用できません。</div>
        <div class="text solution">
            ・Mirakurun サービスが起動しているか確認してください
            <br />
            ・config.yml の mirakurunPath の設定を確認してください
        </div>
    </v-alert>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IServerStatusState from '@/model/state/serverStatus/IServerStatusState';
import { Component, Vue, toNative } from 'vue-facing-decorator';

@Component({})
class ServerStatusBanner extends Vue {
    private serverStatusState: IServerStatusState = container.get<IServerStatusState>('IServerStatusState');

    get isShow(): boolean {
        return this.serverStatusState.isMirakurunAlive === false && this.serverStatusState.isBannerClosed === false;
    }

    public onClose(): void {
        this.serverStatusState.closeBanner();
    }
}

export default toNative(ServerStatusBanner);
</script>

<style lang="sass" scoped>
.server-status-banner
    margin: 8px
    z-index: 900

    .text
        overflow-wrap: break-word
        white-space: normal

    .solution
        font-size: 0.9em
        margin-top: 4px
</style>
