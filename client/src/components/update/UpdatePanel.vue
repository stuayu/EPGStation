<template>
    <div v-if="status !== null">
        <div class="d-flex align-center ga-4 flex-wrap mb-3">
            <div>
                <div class="text-caption text-grey">現在のバージョン</div>
                <div class="text-body-1">{{ status.currentVersion }}</div>
                <div v-if="status.currentCommit !== null" class="text-caption text-grey">
                    {{ status.currentCommit.slice(0, 7) }}
                </div>
            </div>
            <v-spacer></v-spacer>
            <v-btn size="small" variant="text" :loading="checking" prepend-icon="mdi-refresh" @click="check">再チェック</v-btn>
        </div>

        <v-alert v-if="status.checkError !== null" type="error" density="compact" class="mb-3">リリース情報の取得に失敗しました: {{ status.checkError }}</v-alert>
        <v-alert v-if="status.canUpdate === false" type="info" density="compact" class="mb-3">
            {{ status.updateNote }}
        </v-alert>

        <!-- リリース版への更新 -->
        <v-card variant="outlined" class="mb-3">
            <v-card-title class="text-subtitle-1 d-flex align-center ga-2">
                <span>リリース版</span>
                <v-chip v-if="release !== null" size="small" :color="releaseColor" variant="flat">
                    {{ isPrerelease === true ? 'プレリリース' : '正式リリース' }}
                </v-chip>
            </v-card-title>
            <v-card-text>
                <v-alert v-if="release === null" type="success" density="compact" variant="tonal">お使いのバージョンは最新です</v-alert>
                <template v-else>
                    <div class="text-body-1">{{ status.currentVersion }} → {{ release.tag }}</div>
                    <div v-if="release.publishedAt !== null" class="text-caption text-grey">公開: {{ formatDate(release.publishedAt) }}</div>
                    <v-expansion-panels v-if="release.body !== ''" class="mt-2">
                        <v-expansion-panel title="リリースノート">
                            <template v-slot:text>
                                <pre class="update-pre text-body-2">{{ release.body }}</pre>
                            </template>
                        </v-expansion-panel>
                    </v-expansion-panels>
                </template>
            </v-card-text>
            <v-card-actions>
                <v-btn variant="text" size="small" :href="status.releasesUrl" target="_blank" rel="noopener">リリース一覧</v-btn>
                <v-spacer></v-spacer>
                <v-btn v-if="release !== null" color="primary" variant="flat" size="small" :disabled="status.canUpdate === false || isRunning === true" @click="confirm('release')">
                    {{ release.tag }} に更新
                </v-btn>
            </v-card-actions>
        </v-card>

        <!-- 開発版 (ブランチ) への更新 -->
        <v-card v-if="branch !== null" variant="outlined" class="mb-3">
            <v-card-title class="text-subtitle-1 d-flex align-center ga-2">
                <span>開発版 ({{ branch.name }} ブランチ)</span>
                <v-chip size="small" color="blue-grey" variant="flat">開発版</v-chip>
            </v-card-title>
            <v-card-text>
                <!-- 追従済みかどうかに関わらずコミット ID を出す (どこまで進んでいるかを常に確認できるようにする) -->
                <div class="d-flex align-center ga-2 flex-wrap">
                    <span class="text-caption text-grey">ローカル</span>
                    <code class="commit-id">{{ localShortSha }}</code>
                    <template v-if="branch.upToDate === false">
                        <v-icon size="small">mdi-arrow-right</v-icon>
                        <span class="text-caption text-grey">{{ branch.name }} 最新</span>
                        <code class="commit-id">{{ branch.shortSha }}</code>
                    </template>
                    <v-chip v-else size="x-small" color="success" variant="flat">追従済み</v-chip>
                </div>
                <div class="text-body-2 text-truncate mt-2">{{ branch.message }}</div>
                <div v-if="branch.committedAt !== null" class="text-caption text-grey">
                    {{ formatDate(branch.committedAt) }}
                </div>
                <div class="text-caption text-grey mt-1">{{ branch.sha }}</div>
            </v-card-text>
            <v-card-actions>
                <v-btn variant="text" size="small" :href="branch.htmlUrl" target="_blank" rel="noopener">コミットを見る</v-btn>
                <v-spacer></v-spacer>
                <v-btn
                    color="blue-grey"
                    variant="flat"
                    size="small"
                    :disabled="status.canUpdate === false || isRunning === true || branch.upToDate === true"
                    @click="confirm('branch')"
                >
                    {{ branch.name }} の最新に更新
                </v-btn>
            </v-card-actions>
        </v-card>

        <v-checkbox
            v-if="status.canUpdate === true"
            v-model="restartAfterUpdate"
            label="更新後に EPGStation を再起動する"
            density="compact"
            hide-details
            :disabled="isRunning === true"
            class="mb-1"
        ></v-checkbox>
        <div v-if="status.canUpdate === true" class="text-caption text-grey mb-2">{{ status.updateNote }}</div>

        <!-- 更新を伴わない再起動 (設定変更の反映やプロセスの詰まりの解消に使う) -->
        <v-card variant="outlined" class="mb-3">
            <v-card-title class="text-subtitle-1">再起動</v-card-title>
            <v-card-text>
                <div class="text-body-2">更新せずに EPGStation を再起動します。</div>
                <div class="text-caption text-grey mt-1">{{ restartNote }}</div>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn color="error" variant="flat" size="small" :loading="restarting" :disabled="isRunning === true" @click="isOpenRestartConfirm = true">再起動する</v-btn>
            </v-card-actions>
        </v-card>

        <!-- 進捗とログ -->
        <template v-if="job !== null && job.status !== 'idle'">
            <v-divider class="my-3"></v-divider>
            <div class="d-flex align-center ga-2 mb-2">
                <v-progress-circular v-if="isRunning === true" indeterminate size="18" width="2"></v-progress-circular>
                <v-icon v-else-if="job.status === 'succeeded'" color="success">mdi-check-circle</v-icon>
                <v-icon v-else-if="job.status === 'failed'" color="error">mdi-alert-circle</v-icon>
                <span class="text-body-2">{{ jobStatusText }}</span>
            </div>
            <v-alert v-if="job.error !== null" type="error" density="compact" class="mb-2">{{ job.error }}</v-alert>
            <pre class="update-log">{{ logText }}</pre>
        </template>

        <v-dialog v-model="isOpenConfirm" max-width="520">
            <v-card>
                <v-card-title>更新の確認</v-card-title>
                <v-card-text>
                    <p v-if="confirmTarget === 'branch'">{{ branch?.name }} ブランチの最新コミットへ更新します。</p>
                    <p v-else>{{ release?.tag }} へ更新します。</p>
                    <p class="mt-2 text-body-2">ビルドを含むため数分かかり、その間は録画・配信が停止することがあります。</p>
                    <p v-if="restartAfterUpdate === true" class="mt-2 text-body-2">{{ status.updateNote }}</p>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="isOpenConfirm = false">キャンセル</v-btn>
                    <v-btn color="error" variant="text" @click="run">実行する</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <v-dialog v-model="isOpenRestartConfirm" max-width="520">
            <v-card>
                <v-card-title>再起動の確認</v-card-title>
                <v-card-text>
                    <p>EPGStation を再起動します。</p>
                    <p class="mt-2 text-body-2">実行中の録画・配信・エンコードは中断されます。再起動が終わるまで Web UI は操作できません。</p>
                    <p class="mt-2 text-body-2">{{ restartNote }}</p>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="isOpenRestartConfirm = false">キャンセル</v-btn>
                    <v-btn color="error" variant="text" @click="restart">再起動する</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
    <div v-else class="d-flex justify-center py-4">
        <v-progress-circular indeterminate size="24"></v-progress-circular>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import IUpdateApiModel, { UpdateBranchInfo, UpdateJob, UpdateReleaseInfo, UpdateStatus } from '@/model/api/update/IUpdateApiModel';
import DateUtil from '@/util/DateUtil';
import { Component, Vue, toNative } from 'vue-facing-decorator';

/**
 * 更新の状況表示と実行パネル。
 * サーバー設定の「更新」タブと、更新通知のダイアログの両方から使う
 */
@Component({})
class UpdatePanel extends Vue {
    // 更新中の進捗ポーリング間隔
    private static readonly JOB_POLLING_INTERVAL = 2000;
    // 再起動後の復帰確認の間隔と上限 (3 秒 × 60 = 最大 3 分待つ)
    private static readonly RESTART_POLLING_INTERVAL = 3000;
    private static readonly RESTART_WAIT_MAX_COUNT = 60;
    // プロセスが落ちきるまでの猶予 (サーバの終了待ち時間より長く取る)
    private static readonly RESTART_WAIT_MARGIN = 5000;

    status: UpdateStatus | null = null;
    job: UpdateJob | null = null;
    restartAfterUpdate = true;
    checking = false;
    restarting = false;
    isOpenConfirm = false;
    isOpenRestartConfirm = false;
    confirmTarget: 'release' | 'branch' = 'release';

    private timer: number | null = null;
    private api = container.get<IUpdateApiModel>('IUpdateApiModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    get release(): UpdateReleaseInfo | null {
        return this.status?.availableRelease ?? null;
    }
    get branch(): UpdateBranchInfo | null {
        return this.status?.branch ?? null;
    }
    get isPrerelease(): boolean {
        return this.status?.availableChannel === 'prerelease';
    }
    /**
     * ローカル HEAD の短縮コミット ID (git 管理下でない場合は '-')
     */
    get localShortSha(): string {
        return this.status?.currentCommit?.slice(0, 7) ?? '-';
    }
    /**
     * プレリリースは正式リリースと色を変えて、テスト版だと一目で分かるようにする
     */
    get releaseColor(): string {
        return this.isPrerelease === true ? 'deep-purple' : 'primary';
    }
    /**
     * 再起動したあとに誰が起こし直すのかの説明 (サービス管理が無い環境では自前で後継を起動する)
     */
    get restartNote(): string {
        return this.status?.restartNote ?? '';
    }
    get isRunning(): boolean {
        return this.job?.status === 'running' || this.job?.status === 'restarting';
    }
    get jobStatusText(): string {
        if (this.job === null) return '';
        switch (this.job.status) {
            case 'running':
                return this.job.step ?? '更新中...';
            case 'restarting':
                return '更新が完了しました。EPGStation を再起動しています...';
            case 'succeeded':
                return '更新が完了しました (反映には再起動が必要です)';
            case 'failed':
                return '更新に失敗しました';
            default:
                return '';
        }
    }
    get logText(): string {
        return (this.job?.logs ?? []).map(x => x.message).join('\n');
    }

    mounted(): void {
        void this.load();
    }
    beforeUnmount(): void {
        this.stopPolling();
    }

    formatDate(value: number): string {
        return DateUtil.format(new Date(value), 'yyyy/MM/dd hh:mm');
    }

    async load(): Promise<void> {
        try {
            this.status = await this.api.getStatus();
            this.job = this.status.job;
            // 画面を開き直したときに更新中だった場合も進捗を追えるようにする
            if (this.isRunning === true) this.startPolling();
        } catch (err) {
            // 更新チェックは補助機能なので、失敗しても他の表示を妨げない
            console.error(err);
        }
    }

    async check(): Promise<void> {
        this.checking = true;
        try {
            this.status = await this.api.check();
            this.job = this.status.job;
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '更新チェックに失敗しました' });
        } finally {
            this.checking = false;
        }
    }

    confirm(target: 'release' | 'branch'): void {
        this.confirmTarget = target;
        this.isOpenConfirm = true;
    }

    async run(): Promise<void> {
        this.isOpenConfirm = false;
        try {
            this.job =
                this.confirmTarget === 'branch'
                    ? await this.api.runBranch(this.branch?.name, this.restartAfterUpdate)
                    : await this.api.run(this.release?.tag, this.restartAfterUpdate);
            this.startPolling();
        } catch (err: any) {
            console.error(err);
            const message = err?.response?.status === 409 ? 'すでに更新が実行中です' : '更新の開始に失敗しました';
            this.snackbarState.open({ color: 'error', text: message });
        }
    }

    /**
     * 更新を伴わない再起動。
     * サーバは応答を返してからプロセスを終了するため、応答後に復帰を待って画面を読み込み直す
     */
    async restart(): Promise<void> {
        this.isOpenRestartConfirm = false;
        this.restarting = true;
        try {
            const result = await this.api.restart();
            this.snackbarState.open({ color: 'info', text: `再起動しています: ${result.note}` });
            this.waitForRestart(result.restartAt);
        } catch (err: any) {
            console.error(err);
            const message = err?.response?.status === 409 ? '更新が実行中のため再起動できません' : '再起動の開始に失敗しました';
            this.snackbarState.open({ color: 'error', text: message });
            this.restarting = false;
        }
    }

    /**
     * 再起動後にサーバが応答するようになったら画面を読み込み直す。
     * 落ちている間の通信エラーは想定内なので握りつぶし、上限まで待っても戻らなければ手動での確認を促す
     */
    private waitForRestart(restartAt: number): void {
        let count = 0;
        // プロセスが落ちる前に確認すると「まだ生きている」応答を復帰と誤認するため、終了予定時刻を過ぎてから始める
        const delay = Math.max(0, restartAt - Date.now()) + UpdatePanel.RESTART_WAIT_MARGIN;
        window.setTimeout(() => {
            const timer = window.setInterval(async () => {
                count += 1;
                try {
                    await this.api.getStatus();
                    window.clearInterval(timer);
                    this.restarting = false;
                    this.snackbarState.open({ color: 'success', text: '再起動が完了しました' });
                    await this.load();
                } catch (err) {
                    if (count >= UpdatePanel.RESTART_WAIT_MAX_COUNT) {
                        window.clearInterval(timer);
                        this.restarting = false;
                        this.snackbarState.open({
                            color: 'error',
                            text: '再起動後の応答を確認できませんでした。サーバの状態を確認してください',
                        });
                    }
                }
            }, UpdatePanel.RESTART_POLLING_INTERVAL);
        }, delay);
    }

    private startPolling(): void {
        this.stopPolling();
        this.timer = window.setInterval(async () => {
            try {
                this.job = await this.api.getJob();
                if (this.isRunning === false) {
                    this.stopPolling();
                    if (this.job.status === 'succeeded') {
                        this.snackbarState.open({ color: 'success', text: '更新が完了しました' });
                    }
                }
            } catch (err) {
                // 再起動中は API が落ちるため、取得できないこと自体は異常ではない
                console.error(err);
            }
        }, UpdatePanel.JOB_POLLING_INTERVAL);
    }
    private stopPolling(): void {
        if (this.timer !== null) {
            window.clearInterval(this.timer);
            this.timer = null;
        }
    }
}

export default toNative(UpdatePanel);
</script>

<style lang="sass" scoped>
// コミット ID は等幅で見せる
// 背景は固定の黒ではなく、テーマの文字色を薄く重ねてダークモードでも見えるようにする
.commit-id
    font-family: monospace
    font-size: 13px
    background: rgba(var(--v-theme-on-surface), 0.06)
    border-radius: 3px
    padding: 1px 6px

.update-pre
    white-space: pre-wrap
    word-break: break-word
    max-height: 240px
    overflow-y: auto

.update-log
    background: rgba(var(--v-theme-on-surface), 0.06)
    border-radius: 4px
    padding: 8px
    font-size: 12px
    line-height: 1.5
    max-height: 260px
    overflow: auto
    white-space: pre-wrap
    word-break: break-all
</style>
