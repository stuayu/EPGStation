<template>
    <v-main>
        <TitleBar title="サーバー設定"></TitleBar>
        <v-container>
            <v-card class="mx-auto" max-width="900">
                <v-tabs v-model="tab">
                    <v-tab value="integration">連携</v-tab>
                    <v-tab value="notification">通知</v-tab>
                    <v-tab value="series">シリーズ管理</v-tab>
                </v-tabs>
                <v-card-text>
                    <v-window v-model="tab">
                        <v-window-item value="integration">
                            <v-switch v-model="settings.metadata.annict.enabled" label="Annict連携"></v-switch>
                            <v-text-field v-model="settings.metadata.annict.token" label="Annictアクセストークン" type="password" autocomplete="new-password"></v-text-field>
                            <v-switch v-model="settings.metadata.syobocal.enabled" label="しょぼいカレンダー連携"></v-switch>
                        </v-window-item>
                        <v-window-item value="notification">
                            <v-switch v-model="settings.notifications.enabled" label="通知を有効化"></v-switch>
                            <v-text-field v-model="settings.notifications.targets[0].name" label="配信先名"></v-text-field>
                            <v-select v-model="settings.notifications.targets[0].type" :items="['discord', 'webhook']" label="種別"></v-select>
                            <v-text-field v-model="settings.notifications.targets[0].url" label="Webhook URL"></v-text-field>
                            <v-text-field v-model="settings.notifications.targets[0].secret" type="password" label="署名シークレット（汎用Webhook）"></v-text-field>
                            <v-btn variant="outlined" :loading="testing" @click="testNotification">テスト通知</v-btn>
                        </v-window-item>
                        <v-window-item value="series">
                            <v-slider v-model="settings.series.matchThreshold" :min="0" :max="1" :step="0.05" label="自動マッチしきい値"></v-slider>
                        </v-window-item>
                    </v-window>
                    <v-alert v-if="message" type="success" class="mb-3">{{ message }}</v-alert>
                    <v-btn color="primary" :loading="saving" @click="save">保存</v-btn>
                </v-card-text>
            </v-card>
        </v-container>
    </v-main>
</template>
<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISystemSettingApiModel from '@/model/api/config/ISystemSettingApiModel';
import { Component, Vue, toNative } from 'vue-facing-decorator';
@Component({ components: { TitleBar } })
class SystemSetting extends Vue {
    tab = 'integration';
    saving = false;
    testing = false;
    message = '';
    private api = container.get<ISystemSettingApiModel>('ISystemSettingApiModel');
    settings: any = {
        metadata: { annict: { enabled: false, token: '' }, syobocal: { enabled: false } },
        notifications: {
            enabled: false,
            maxAttempts: 5,
            baseDelayMs: 1000,
            timeoutMs: 10000,
            targets: [{ name: 'default', type: 'discord', url: '', secret: '', events: ['recording.started', 'recording.completed', 'recording.failed'] }],
        },
        series: { matchThreshold: 0.8 },
    };
    async mounted() {
        const loaded = await this.api.get();
        this.settings = {
            ...this.settings,
            ...loaded,
            metadata: {
                ...this.settings.metadata,
                ...loaded.metadata,
                annict: { ...this.settings.metadata.annict, ...loaded.metadata?.annict },
                syobocal: { ...this.settings.metadata.syobocal, ...loaded.metadata?.syobocal },
            },
            notifications: { ...this.settings.notifications, ...loaded.notifications },
            series: { ...this.settings.series, ...loaded.series },
        };
    }
    async testNotification() {
        this.testing = true;
        this.message = '';
        try {
            await this.save();
            await this.api.testNotification(this.settings.notifications.targets[0]?.name);
            this.message = 'テスト通知を送信しました';
        } finally {
            this.testing = false;
        }
    }
    async save() {
        this.saving = true;
        this.message = '';
        try {
            this.settings = await this.api.update(this.settings);
            this.message = '保存しました';
        } finally {
            this.saving = false;
        }
    }
}
export default toNative(SystemSetting);
</script>
