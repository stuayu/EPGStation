<template>
    <v-main>
        <TitleBar title="サーバー設定"></TitleBar>
        <v-container>
            <v-alert v-if="requiresRestartKeys.length > 0" type="warning" closable class="mx-auto mb-4" max-width="900" @click:close="requiresRestartKeys = []">
                再起動が必要です ({{ requiresRestartKeys.join('、') }})。変更を反映するには Operator プロセスの再起動が必要です。
            </v-alert>
            <v-card class="mx-auto" max-width="900">
                <v-tabs v-model="tab">
                    <v-tab value="basic">基本</v-tab>
                    <v-tab value="recording">録画・エンコード</v-tab>
                    <v-tab value="integration">連携</v-tab>
                    <v-tab value="notification">通知</v-tab>
                    <v-tab value="series">シリーズ管理</v-tab>
                </v-tabs>
                <v-card-text>
                    <v-window v-model="tab">
                        <!-- 基本タブ: 変更履歴・ロールバック -->
                        <v-window-item value="basic">
                            <div class="text-subtitle-1 mb-2">変更履歴・ロールバック</div>
                            <v-select v-model="historyKey" :items="historyKeyItems" label="対象キー" v-on:update:model-value="loadHistory"></v-select>
                            <v-alert v-if="historyItems.length === 0" type="info" class="mb-2">変更履歴はありません</v-alert>
                            <v-table v-else density="compact" class="mb-2">
                                <thead>
                                    <tr>
                                        <th>日時</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="h in historyItems" :key="h.id">
                                        <td>{{ formatDate(h.updatedAt) }}</td>
                                    </tr>
                                </tbody>
                            </v-table>
                            <v-btn variant="outlined" color="error" :disabled="historyItems.length === 0" :loading="rollbacking" @click="rollback"
                                >直前の状態へロールバック</v-btn
                            >
                            <v-divider class="my-4"></v-divider>
                            <v-alert type="info">現在、再起動 (Operator 再初期化) が必須の設定項目はありません。今後追加された場合、このタブと画面上部のバナーで通知されます。</v-alert>
                        </v-window-item>

                        <!-- 録画・エンコードタブ -->
                        <v-window-item value="recording">
                            <v-alert type="info"
                                >現在、WebUI から変更可能な録画・エンコード関連のシステム設定項目はありません。録画・エンコードの設定は <code>config/config.yml</code>
                                で行ってください。</v-alert
                            >
                        </v-window-item>

                        <!-- 連携タブ -->
                        <v-window-item value="integration">
                            <div class="text-subtitle-1 mb-2">Annict 連携</div>
                            <v-switch v-model="settings.metadata.annict.enabled" label="Annict連携を有効化"></v-switch>
                            <v-text-field
                                v-model="settings.metadata.annict.token"
                                label="Annictアクセストークン"
                                type="password"
                                autocomplete="new-password"
                                hint="サーバーに保存済みの値はマスクして表示されます。変更する場合のみ新しい値を入力してください"
                                persistent-hint
                            ></v-text-field>
                            <div class="d-flex align-center ga-2 my-2">
                                <v-btn variant="outlined" :loading="annictTesting" @click="testAnnictConnection">接続テスト</v-btn>
                                <span v-if="annictTestResult" class="text-body-2">{{ annictTestResult }}</span>
                            </div>
                            <v-alert type="info" density="compact" class="mb-2"
                                >注: 専用のテスト API が無いため Annict 検索 API を用いた簡易疎通確認です。トークンが無効でも空の検索結果のみ返る場合があります。</v-alert
                            >
                            <v-alert type="info" density="compact" class="mb-4"
                                >視聴記録の自動同期はサーバー設定 (featureFlags.annictSync, config.yml) で制御されます。現在の状態:
                                {{ isEnabledAnnictSync ? '有効' : '無効' }} (WebUI からは変更できません)</v-alert
                            >

                            <v-divider class="my-4"></v-divider>
                            <div class="text-subtitle-1 mb-2">しょぼいカレンダー連携</div>
                            <v-switch v-model="settings.metadata.syobocal.enabled" label="しょぼいカレンダー連携を有効化"></v-switch>
                            <v-alert type="info" density="compact"
                                >チャンネルマッピング表・共有静的データの自動更新間隔は現状 <code>config/config.yml</code> の
                                <code>metadataChannelMappingPath</code> / <code>metadataSharedDataUrl</code> /
                                <code>metadataSharedDataUpdateIntervalMs</code> でのみ設定可能です。編集用の Web API が未実装のため、この画面からは変更できません。</v-alert
                            >

                            <v-divider class="my-4"></v-divider>
                            <div class="text-subtitle-1 mb-2">メタデータキャッシュ</div>
                            <v-text-field
                                v-model.number="settings.metadata.cacheTtlMs"
                                type="number"
                                label="キャッシュ有効期間 (ms)"
                                hint="外部メタデータ検索結果のキャッシュ有効期間"
                                persistent-hint
                            ></v-text-field>
                        </v-window-item>

                        <!-- 通知タブ -->
                        <v-window-item value="notification">
                            <v-switch v-model="settings.notifications.enabled" label="通知を有効化"></v-switch>
                            <v-row>
                                <v-col cols="4">
                                    <v-text-field v-model.number="settings.notifications.maxAttempts" type="number" label="最大リトライ回数"></v-text-field>
                                </v-col>
                                <v-col cols="4">
                                    <v-text-field v-model.number="settings.notifications.baseDelayMs" type="number" label="リトライ基準遅延 (ms)"></v-text-field>
                                </v-col>
                                <v-col cols="4">
                                    <v-text-field v-model.number="settings.notifications.timeoutMs" type="number" label="タイムアウト (ms)"></v-text-field>
                                </v-col>
                            </v-row>

                            <div class="d-flex align-center mb-2">
                                <div class="text-subtitle-1">配信先一覧</div>
                                <v-spacer></v-spacer>
                                <v-btn size="small" variant="outlined" color="primary" @click="addNotificationTarget">配信先を追加</v-btn>
                            </div>
                            <v-alert v-if="settings.notifications.targets.length === 0" type="info" class="mb-2">配信先がありません。「配信先を追加」から追加してください</v-alert>
                            <v-card v-for="(target, index) in settings.notifications.targets" :key="target.__key" variant="outlined" class="mb-3 pa-3">
                                <div class="d-flex align-center ga-2">
                                    <v-text-field v-model="target.name" label="配信先名" density="compact" hide-details class="flex-grow-1" v-on:blur="onTargetNameChanged(target)"></v-text-field>
                                    <v-btn icon variant="text" color="error" @click="removeNotificationTarget(index)"><v-icon>mdi-delete</v-icon></v-btn>
                                </div>
                                <v-alert v-if="target.__renamed === true" type="warning" density="compact" class="my-2"
                                    >配信先名を変更すると、保存済みのシークレット (URL・署名シークレット) は引き継がれません。URL・シークレットを再入力してください</v-alert
                                >
                                <v-select v-model="target.type" :items="['discord', 'webhook']" label="種別" density="compact"></v-select>
                                <v-text-field v-model="target.url" label="Webhook URL" density="compact"></v-text-field>
                                <v-text-field
                                    v-if="target.type === 'webhook'"
                                    v-model="target.secret"
                                    type="password"
                                    label="署名シークレット（汎用Webhook）"
                                    density="compact"
                                    autocomplete="new-password"
                                ></v-text-field>
                                <v-select
                                    v-model="target.events"
                                    :items="notificationEventItems"
                                    label="通知イベント"
                                    multiple
                                    chips
                                    density="compact"
                                ></v-select>
                                <v-btn size="small" variant="outlined" :loading="testingTargetName === target.name" @click="testNotification(target.name)"
                                    >この配信先へテスト通知</v-btn
                                >
                            </v-card>

                            <v-divider class="my-4"></v-divider>
                            <div class="text-subtitle-1 mb-2">通知の失敗履歴 (リトライ上限到達)</div>
                            <v-btn size="small" variant="text" @click="loadNotificationFailures">再読み込み</v-btn>
                            <v-alert v-if="notificationFailures.length === 0" type="info" class="mt-2">失敗履歴はありません</v-alert>
                            <v-table v-else density="compact">
                                <thead>
                                    <tr>
                                        <th>配信先</th>
                                        <th>イベント</th>
                                        <th>試行回数</th>
                                        <th>最終エラー</th>
                                        <th>日時</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="f in notificationFailures" :key="f.id">
                                        <td>{{ f.targetName }}</td>
                                        <td>{{ f.eventType }}</td>
                                        <td>{{ f.attempts }}</td>
                                        <td>{{ f.lastError ?? '-' }}</td>
                                        <td>{{ formatDate(f.updatedAt) }}</td>
                                    </tr>
                                </tbody>
                            </v-table>
                        </v-window-item>

                        <!-- シリーズ管理タブ -->
                        <v-window-item value="series">
                            <v-slider v-model="settings.series.matchThreshold" :min="0" :max="1" :step="0.05" label="自動マッチしきい値"></v-slider>

                            <template v-if="isEnabledSeriesLibrary === true">
                            <v-divider class="my-4"></v-divider>
                            <div class="text-subtitle-1 mb-2">精度メトリクス (§4.10)</div>
                            <v-btn size="small" variant="text" @click="loadMetrics">再読み込み</v-btn>
                            <div v-if="metrics !== null" class="mt-2">
                                <div>対象番組数: {{ metrics.totalPrograms }} / マッチ済み: {{ metrics.matchedPrograms }}</div>
                                <div>未マッチ番組率: {{ (metrics.unmatchedRate * 100).toFixed(1) }}%</div>
                                <div class="mt-2">confidence 分布 (0-0.2 / 0.2-0.4 / 0.4-0.6 / 0.6-0.8 / 0.8-1.0)</div>
                                <div class="d-flex ga-2">
                                    <v-chip v-for="(c, i) in metrics.confidenceHistogram" :key="i" size="small">{{ c }}</v-chip>
                                </div>
                                <div v-if="metrics.updatedAt !== null" class="text-caption mt-1">最終更新: {{ formatDate(metrics.updatedAt) }}</div>
                            </div>
                            <v-alert v-else type="info" class="mt-2">メトリクスは未取得です</v-alert>

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
                    <v-btn color="primary" :loading="saving" @click="save">保存</v-btn>
                </v-card-text>
            </v-card>
        </v-container>
    </v-main>
</template>
<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import IRepositoryModel from '@/model/api/IRepositoryModel';
import ISystemSettingApiModel from '@/model/api/config/ISystemSettingApiModel';
import ISeriesApiModel, { SeriesAliasItem, SeriesBackfillResult, ProgramSeriesMetrics } from '@/model/api/series/ISeriesApiModel';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { isFeatureEnabled } from '@/util/FeatureFlags';
import DateUtil from '@/util/DateUtil';
import { Component, Vue, toNative } from 'vue-facing-decorator';
import * as apid from '../../../api';

interface NotificationTargetForm {
    __key: string;
    __renamed?: boolean;
    name: string;
    type: string;
    url: string;
    secret: string;
    events: string[];
}

@Component({ components: { TitleBar } })
class SystemSetting extends Vue {
    tab = 'basic';
    saving = false;
    testingTargetName: string | null = null;

    private api = container.get<ISystemSettingApiModel>('ISystemSettingApiModel');
    private repository = container.get<IRepositoryModel>('IRepositoryModel');
    private seriesApi = container.get<ISeriesApiModel>('ISeriesApiModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private serverConfigModel: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');

    requiresRestartKeys: string[] = [];

    readonly notificationEventItems: string[] = [
        'recording.started',
        'recording.completed',
        'recording.failed',
        'reserve.added',
        'reserve.updated',
        'reserve.deleted',
    ];

    /**
     * シリーズライブラリ機能が有効か (featureFlags.seriesLibrary)。無効な場合はバックフィル/エイリアス管理 UI を隠す
     */
    get isEnabledSeriesLibrary(): boolean {
        return isFeatureEnabled(this.serverConfigModel.getConfig(), 'seriesLibrary');
    }

    get isEnabledAnnictSync(): boolean {
        const config = this.serverConfigModel.getConfig();
        return isFeatureEnabled(config, 'metadataProviders') === true && isFeatureEnabled(config, 'annictSync') === true;
    }

    backfillStatus: SeriesBackfillResult | null = null;
    backfillStarting = false;
    private backfillPollTimer: ReturnType<typeof setInterval> | null = null;
    aliases: SeriesAliasItem[] = [];
    metrics: ProgramSeriesMetrics | null = null;

    historyKey = 'notifications';
    readonly historyKeyItems = [
        { title: '通知 (notifications)', value: 'notifications' },
        { title: '連携 (metadata)', value: 'metadata' },
        { title: 'シリーズ (series)', value: 'series' },
        { title: 'ダッシュボード (dashboard)', value: 'dashboard' },
    ];
    historyItems: apid.AppSettingHistoryItem[] = [];
    rollbacking = false;

    notificationFailures: apid.NotificationFailureHistoryItem[] = [];

    annictTesting = false;
    annictTestResult: string | null = null;

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

    formatDate(unixtimeMs: number): string {
        return DateUtil.format(new Date(unixtimeMs), 'yyyy/MM/dd hh:mm:ss');
    }

    settings: any = {
        metadata: { annict: { enabled: false, token: '' }, syobocal: { enabled: false }, cacheTtlMs: 24 * 60 * 60 * 1000 },
        notifications: {
            enabled: false,
            maxAttempts: 5,
            baseDelayMs: 1000,
            timeoutMs: 10000,
            targets: [] as NotificationTargetForm[],
        },
        series: { matchThreshold: 0.8 },
    };

    private targetKeySeed = 0;
    private nextTargetKey(): string {
        this.targetKeySeed += 1;
        return `target-${Date.now()}-${this.targetKeySeed}`;
    }

    async mounted() {
        if (isFeatureEnabled(this.serverConfigModel.getConfig(), 'systemSettings') === false) {
            this.snackbarState.open({ color: 'error', text: 'サーバー設定機能は無効化されています' });
            await this.$router.replace('/settings');
            return;
        }
        try {
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
            this.settings.notifications.targets = (loaded.notifications?.targets ?? []).map((t: any) => ({
                __key: this.nextTargetKey(),
                name: t.name ?? '',
                type: t.type ?? 'discord',
                url: t.url ?? '',
                secret: t.secret ?? '',
                events: t.events ?? [],
            }));
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'システム設定の取得に失敗しました' });
        }

        if (this.isEnabledSeriesLibrary === true) {
            await this.refreshBackfillStatus();
            await this.loadAliases();
            await this.loadMetrics();
        }
        await this.loadHistory();
        await this.loadNotificationFailures();
    }

    beforeUnmount() {
        this.stopBackfillPolling();
    }

    addNotificationTarget(): void {
        this.settings.notifications.targets.push({
            __key: this.nextTargetKey(),
            name: `target-${this.settings.notifications.targets.length + 1}`,
            type: 'discord',
            url: '',
            secret: '',
            events: ['recording.started', 'recording.completed', 'recording.failed'],
        });
    }

    removeNotificationTarget(index: number | string): void {
        this.settings.notifications.targets.splice(Number(index), 1);
    }

    onTargetNameChanged(target: NotificationTargetForm): void {
        target.__renamed = true;
    }

    async loadMetrics(): Promise<void> {
        try {
            this.metrics = await this.seriesApi.getMetrics();
        } catch (err) {
            console.error(err);
        }
    }

    async loadHistory(): Promise<void> {
        try {
            this.historyItems = await this.api.getHistory(this.historyKey);
        } catch (err) {
            console.error(err);
            this.historyItems = [];
        }
    }

    async rollback(): Promise<void> {
        this.rollbacking = true;
        try {
            const result = await this.api.rollback(this.historyKey);
            this.applyUpdateResult(result);
            this.snackbarState.open({ color: 'success', text: 'ロールバックしました' });
            await this.loadHistory();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'ロールバックに失敗しました' });
        } finally {
            this.rollbacking = false;
        }
    }

    async loadNotificationFailures(): Promise<void> {
        try {
            this.notificationFailures = await this.api.getNotificationFailures(50);
        } catch (err) {
            console.error(err);
        }
    }

    async testAnnictConnection(): Promise<void> {
        this.annictTesting = true;
        this.annictTestResult = null;
        try {
            // 専用のテスト API が無いため、外部メタデータ検索 API (providers=annict) を使った簡易疎通確認
            const res = await this.repository.get('/metadata/search', { params: { query: 'test', providers: 'annict' } });
            const count = Array.isArray(res.data?.results) ? res.data.results.length : 0;
            this.annictTestResult = count > 0 ? `応答あり (${count} 件の検索結果)` : '応答はありましたが検索結果は 0 件でした (トークンが正しいかご確認ください)';
        } catch (err: any) {
            console.error(err);
            const status = err?.response?.status;
            this.annictTestResult = typeof status === 'number' ? `疎通確認に失敗しました (HTTP ${status})` : '疎通確認に失敗しました (通信エラー)';
        } finally {
            this.annictTesting = false;
        }
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

    async testNotification(targetName: string) {
        this.testingTargetName = targetName;
        try {
            const result = await this.api.testNotification(targetName);
            if (result.failed.length > 0) {
                this.snackbarState.open({ color: 'error', text: `テスト通知に失敗しました: ${result.failed.join('、')}` });
            } else {
                this.snackbarState.open({ color: 'success', text: 'テスト通知を送信しました' });
            }
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'テスト通知の送信に失敗しました (先に保存が必要な場合があります)' });
        } finally {
            this.testingTargetName = null;
        }
    }

    private applyUpdateResult(result: apid.AppSettingUpdateResult): void {
        this.requiresRestartKeys = result.requiresRestartKeys;
        const loaded = result.settings;
        this.settings = {
            ...this.settings,
            ...loaded,
            metadata: {
                ...this.settings.metadata,
                ...loaded.metadata,
                annict: { ...this.settings.metadata.annict, ...(loaded.metadata as any)?.annict },
                syobocal: { ...this.settings.metadata.syobocal, ...(loaded.metadata as any)?.syobocal },
            },
            notifications: { ...this.settings.notifications, ...loaded.notifications },
            series: { ...this.settings.series, ...loaded.series },
        };
        this.settings.notifications.targets = ((loaded.notifications as any)?.targets ?? []).map((t: any) => ({
            __key: this.nextTargetKey(),
            name: t.name ?? '',
            type: t.type ?? 'discord',
            url: t.url ?? '',
            secret: t.secret ?? '',
            events: t.events ?? [],
        }));
    }

    async save() {
        this.saving = true;
        try {
            const payload = {
                metadata: this.settings.metadata,
                notifications: {
                    ...this.settings.notifications,
                    targets: this.settings.notifications.targets.map((t: NotificationTargetForm) => ({
                        name: t.name,
                        type: t.type,
                        url: t.url,
                        secret: t.secret,
                        events: t.events,
                    })),
                },
                series: this.settings.series,
            };
            const result = await this.api.update(payload);
            this.applyUpdateResult(result);
            this.snackbarState.open({ color: 'success', text: '保存しました' });
            await this.loadHistory();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '保存に失敗しました' });
        } finally {
            this.saving = false;
        }
    }
}
export default toNative(SystemSetting);
</script>
