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

                            <template v-if="isEnabledSeriesLibrary === true">
                            <v-divider class="my-4"></v-divider>
                            <div class="text-subtitle-1 mb-2">既存録画の一括シリーズ化 (バックフィル)</div>
                            <div v-if="backfillStatus" class="mb-2">
                                <div>状態: {{ backfillStateText }}</div>
                                <v-progress-linear
                                    v-if="backfillStatus.state === 'running'"
                                    :model-value="backfillProgressPercent"
                                    height="20"
                                    color="primary"
                                    striped
                                >
                                    <template #default>{{ backfillStatus.processed }} / {{ backfillStatus.total }}</template>
                                </v-progress-linear>
                                <div v-if="backfillStatus.state !== 'idle'" class="mt-1">
                                    確定: {{ backfillStatus.linked }} / 未確定: {{ backfillStatus.pending }} / スキップ: {{ backfillStatus.skipped }} / 失敗:
                                    {{ backfillStatus.failed }}
                                </div>
                                <v-alert v-if="backfillStatus.error" type="error" class="mt-2">{{ backfillStatus.error }}</v-alert>
                            </div>
                            <div class="d-flex flex-wrap ga-2 mb-3">
                                <v-btn variant="outlined" :loading="backfillStarting" :disabled="backfillStatus?.state === 'running'" @click="startBackfill(true)"
                                    >ドライラン実行</v-btn
                                >
                                <v-btn color="primary" variant="outlined" :loading="backfillStarting" :disabled="backfillStatus?.state === 'running'" @click="startBackfill(false)"
                                    >本実行 (確定適用)</v-btn
                                >
                                <v-btn color="error" variant="outlined" :disabled="backfillStatus?.state !== 'running'" @click="cancelBackfill">キャンセル</v-btn>
                            </div>

                            <v-card v-if="backfillStatus?.previewItems && backfillStatus.previewItems.length > 0" variant="outlined" class="mb-4">
                                <v-card-title class="text-subtitle-1">
                                    ドライラン結果プレビュー
                                    <span v-if="backfillStatus.previewTruncated === true">(一部のみ表示)</span>
                                </v-card-title>
                                <v-table density="compact">
                                    <thead>
                                        <tr>
                                            <th>録画</th>
                                            <th>判定</th>
                                            <th>候補</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr v-for="p in backfillStatus.previewItems" :key="p.recordedId">
                                            <td>{{ p.title }}</td>
                                            <td>
                                                <v-chip v-if="p.matched === true" color="success" size="small">{{ p.seriesTitle }} ({{ Math.round((p.confidence ?? 0) * 100) }}%)</v-chip>
                                                <v-chip v-else color="warning" size="small">未確定</v-chip>
                                            </td>
                                            <td>{{ p.candidates.map(c => c.seriesTitle).join('、') }}</td>
                                        </tr>
                                    </tbody>
                                </v-table>
                            </v-card>

                            <v-divider class="my-4"></v-divider>
                            <div class="text-subtitle-1 mb-2">エイリアス辞書</div>
                            <v-table density="compact">
                                <thead>
                                    <tr>
                                        <th>正規化タイトル</th>
                                        <th>シリーズ</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="a in aliases" :key="a.id">
                                        <td>{{ a.normalizedTitle }}</td>
                                        <td>{{ a.seriesTitle }}</td>
                                        <td><v-btn size="small" variant="text" color="error" @click="removeAlias(a.id)">削除</v-btn></td>
                                    </tr>
                                </tbody>
                            </v-table>
                            <v-alert v-if="aliases.length === 0" type="info" class="mt-2">エイリアスはありません</v-alert>
                            </template>
                            <v-alert v-else type="info" class="mt-4">シリーズライブラリ機能 (featureFlags.seriesLibrary) が無効なため、バックフィルとエイリアス管理は利用できません</v-alert>
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
import ISeriesApiModel, { SeriesAliasItem, SeriesBackfillResult } from '@/model/api/series/ISeriesApiModel';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { isFeatureEnabled } from '@/util/FeatureFlags';
import { Component, Vue, toNative } from 'vue-facing-decorator';
@Component({ components: { TitleBar } })
class SystemSetting extends Vue {
    tab = 'integration';
    saving = false;
    testing = false;
    message = '';
    private api = container.get<ISystemSettingApiModel>('ISystemSettingApiModel');
    private seriesApi = container.get<ISeriesApiModel>('ISeriesApiModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private serverConfigModel: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');

    /**
     * シリーズライブラリ機能が有効か (featureFlags.seriesLibrary)。無効な場合はバックフィル/エイリアス管理 UI を隠す
     */
    get isEnabledSeriesLibrary(): boolean {
        return isFeatureEnabled(this.serverConfigModel.getConfig(), 'seriesLibrary');
    }

    backfillStatus: SeriesBackfillResult | null = null;
    backfillStarting = false;
    private backfillPollTimer: ReturnType<typeof setInterval> | null = null;
    aliases: SeriesAliasItem[] = [];

    get backfillStateText(): string {
        const map: Record<string, string> = { idle: '未実行', running: '実行中', completed: '完了', canceled: 'キャンセル済み', failed: '失敗' };
        return this.backfillStatus ? (map[this.backfillStatus.state] ?? this.backfillStatus.state) : '';
    }

    get backfillProgressPercent(): number {
        if (this.backfillStatus === null || this.backfillStatus.total === 0) {
            return 0;
        }
        return Math.min(100, Math.round((this.backfillStatus.processed / this.backfillStatus.total) * 100));
    }

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

        if (this.isEnabledSeriesLibrary === true) {
            await this.refreshBackfillStatus();
            await this.loadAliases();
        }
    }

    beforeUnmount() {
        this.stopBackfillPolling();
    }

    async refreshBackfillStatus(): Promise<void> {
        try {
            this.backfillStatus = await this.seriesApi.getBackfillStatus();
            if (this.backfillStatus.state === 'running') {
                this.startBackfillPolling();
            } else {
                this.stopBackfillPolling();
            }
        } catch (err) {
            // シリーズ機能無効時 (404) 等は静かに無視する
            console.error(err);
        }
    }

    startBackfillPolling(): void {
        if (this.backfillPollTimer !== null) {
            return;
        }
        this.backfillPollTimer = setInterval(() => {
            void this.refreshBackfillStatus();
        }, 2000);
    }

    stopBackfillPolling(): void {
        if (this.backfillPollTimer !== null) {
            clearInterval(this.backfillPollTimer);
            this.backfillPollTimer = null;
        }
    }

    async startBackfill(dryRun: boolean): Promise<void> {
        this.backfillStarting = true;
        try {
            this.backfillStatus = await this.seriesApi.startBackfill({ dryRun });
            this.snackbarState.open({ color: 'success', text: dryRun ? 'ドライランを開始しました' : 'バックフィルを開始しました' });
            this.startBackfillPolling();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'バックフィルの開始に失敗しました' });
        } finally {
            this.backfillStarting = false;
        }
    }

    async cancelBackfill(): Promise<void> {
        try {
            await this.seriesApi.cancelBackfill();
            this.snackbarState.open({ color: 'success', text: 'バックフィルをキャンセルしました' });
            await this.refreshBackfillStatus();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'キャンセルに失敗しました' });
        }
    }

    async loadAliases(): Promise<void> {
        try {
            this.aliases = await this.seriesApi.listAliases();
        } catch (err) {
            console.error(err);
        }
    }

    async removeAlias(aliasId: number): Promise<void> {
        try {
            await this.seriesApi.removeAlias(aliasId);
            await this.loadAliases();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'エイリアスの削除に失敗しました' });
        }
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
