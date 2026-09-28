<template>
    <v-main>
        <TitleBar title="録画結果"></TitleBar>
        <v-container>
            <div class="d-flex flex-wrap align-end ga-2 mb-4">
                <v-select
                    v-model="statusFilter"
                    :items="statusOptions"
                    label="結果"
                    density="compact"
                    hide-details
                    clearable
                    style="min-width: 145px; max-width: 220px"
                    @update:model-value="onChangeFilter"
                ></v-select>
                <v-text-field
                    v-model="fromDate"
                    label="開始日"
                    type="date"
                    density="compact"
                    hide-details
                    style="min-width: 145px; max-width: 190px"
                    @change="onChangeFilter"
                ></v-text-field>
                <v-text-field
                    v-model="toDate"
                    label="終了日"
                    type="date"
                    density="compact"
                    hide-details
                    style="min-width: 145px; max-width: 190px"
                    @change="onChangeFilter"
                ></v-text-field>
                <v-text-field
                    v-model="keyword"
                    label="番組名"
                    density="compact"
                    hide-details
                    clearable
                    style="min-width: 160px; max-width: 280px"
                    @keyup.enter="onChangeFilter"
                    @click:clear="onChangeFilter"
                ></v-text-field>
                <v-btn variant="outlined" :loading="isLoading" @click="onChangeFilter">検索</v-btn>
                <span class="text-caption text-grey ml-auto">{{ total }} 件</span>
            </div>

            <v-alert v-if="isLoading === false && items.length === 0" type="info" variant="tonal">録画結果はありません</v-alert>
            <v-expansion-panels v-else v-model="openedSession" variant="accordion">
                <v-expansion-panel v-for="session in items" :key="session.id" :value="session.id" @group:selected="onToggleSession(session, $event.value)">
                    <v-expansion-panel-title>
                        <div class="result-heading">
                            <div class="d-flex flex-wrap align-center ga-2">
                                <v-chip size="small" variant="tonal" :color="statusColor(session.resultStatus)">{{ statusLabel(session.resultStatus) }}</v-chip>
                                <span class="font-weight-medium">{{ session.name || '番組名不明' }}</span>
                                <v-btn v-if="session.recordedId !== undefined" size="x-small" variant="text" @click.stop="openRecorded(session.recordedId)">録画詳細</v-btn>
                            </div>
                            <div class="text-caption text-medium-emphasis mt-1">
                                {{ formatTimestamp(session.scheduledStartAt) }} — {{ formatTimestamp(session.scheduledEndAt) }}
                                <span v-if="session.channelName">・ {{ session.channelName }}</span>
                                <span>・ 開始: {{ reasonLabel(session.startReason) }} / 終了: {{ reasonLabel(session.endReason) }}</span>
                                <span>・ 再試行 {{ session.retryCount }} 回</span>
                            </div>
                        </div>
                    </v-expansion-panel-title>
                    <v-expansion-panel-text>
                        <v-progress-linear v-if="loadingSessionId === session.id" indeterminate></v-progress-linear>
                        <div v-else-if="detail(session.id) !== undefined">
                            <div class="text-caption mb-2">実録画: {{ formatTimestamp(session.actualStartAt) }} — {{ formatTimestamp(session.actualEndAt) }}</div>
                            <v-table density="compact" class="attempt-table">
                                <thead>
                                    <tr>
                                        <th>試行</th>
                                        <th>要求</th>
                                        <th>初回データ</th>
                                        <th>終了</th>
                                        <th>理由</th>
                                        <th>受信量</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="attempt in detail(session.id)!.attempts" :key="attempt.id">
                                        <td>{{ attempt.attemptNo }}</td>
                                        <td>{{ formatTimestamp(attempt.requestedAt) }}</td>
                                        <td>{{ formatTimestamp(attempt.firstDataAt) }}</td>
                                        <td>{{ formatTimestamp(attempt.endedAt) }}</td>
                                        <td>{{ reasonLabel(attempt.closeReason || attempt.errorCode) }}</td>
                                        <td>{{ formatBytes(attempt.bytesReceived) }}</td>
                                    </tr>
                                    <tr v-if="detail(session.id)!.attempts.length === 0"><td colspan="6" class="text-medium-emphasis">接続試行なし</td></tr>
                                </tbody>
                            </v-table>
                        </div>
                    </v-expansion-panel-text>
                </v-expansion-panel>
            </v-expansion-panels>
            <v-pagination
                v-if="pageCount > 1"
                v-model="page"
                :length="pageCount"
                :total-visible="isMobile === true ? 3 : 5"
                :show-first-last-page="isMobile === false"
                class="mt-3"
                @update:model-value="fetchData"
            ></v-pagination>
        </v-container>
    </v-main>
</template>

<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import IRecordingResultsState from '@/model/state/recordingResults/IRecordingResultsState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import IRecordingResultsApiModel from '@/model/api/recordingResults/IRecordingResultsApiModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import RecordingReasonUtil from '@/util/RecordingReasonUtil';
import { Component, Vue, toNative } from 'vue-facing-decorator';
import * as apid from '../../../api';

@Component({ components: { TitleBar } })
class RecordingResults extends Vue {
    private static readonly PAGE_SIZE = 30;
    public statusFilter: apid.RecordingResultSession['resultStatus'] | null = null;
    public fromDate: string = '';
    public toDate: string = '';
    public keyword: string = '';
    public page: number = 1;
    public isLoading: boolean = false;
    public openedSession: number | undefined;
    public loadingSessionId: number | null = null;
    public items: apid.RecordingResultSession[] = [];
    public total: number = 0;
    private recordingResultsState: IRecordingResultsState = container.get<IRecordingResultsState>('IRecordingResultsState');
    private recordingResultsApiModel: IRecordingResultsApiModel = container.get<IRecordingResultsApiModel>('IRecordingResultsApiModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    public statusOptions = [
        { title: '完了', value: 'completed' },
        { title: '一部欠落', value: 'partial' },
        { title: '失敗', value: 'failed' },
        { title: '中止', value: 'canceled' },
    ];

    get isMobile(): boolean {
        return this.$vuetify.display.smAndDown;
    }

    get pageCount(): number {
        return Math.ceil(this.total / RecordingResults.PAGE_SIZE);
    }

    public mounted(): void {
        void this.fetchData();
    }

    public onChangeFilter(): void {
        this.page = 1;
        void this.fetchData();
    }

    public async fetchData(): Promise<void> {
        this.isLoading = true;
        try {
            await this.recordingResultsState.fetch({
                result: this.statusFilter ?? undefined,
                from: this.fromDate ? new Date(`${this.fromDate}T00:00:00`).getTime() : undefined,
                to: this.toDate ? new Date(`${this.toDate}T23:59:59.999`).getTime() : undefined,
                keyword: this.keyword.trim() || undefined,
                offset: (this.page - 1) * RecordingResults.PAGE_SIZE,
                limit: RecordingResults.PAGE_SIZE,
            });
            this.items = this.recordingResultsState.getItems();
            this.total = this.recordingResultsState.getTotal();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '録画結果の取得に失敗しました' });
        } finally {
            this.isLoading = false;
            await this.scrollState.emitDoneGetData();
        }
    }

    public async onToggleSession(session: apid.RecordingResultSession, isOpen: boolean): Promise<void> {
        if (isOpen !== true || this.recordingResultsState.getDetail(session.id) !== undefined) return;
        this.loadingSessionId = session.id;
        try {
            await this.recordingResultsState.fetchDetail(session.id);
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '接続試行の取得に失敗しました' });
        } finally {
            this.loadingSessionId = null;
        }
    }

    public detail(id: number): apid.RecordingResultDetail | undefined {
        return this.recordingResultsState.getDetail(id);
    }
    public statusLabel(status: apid.RecordingResultSession['resultStatus']): string {
        switch (status) {
            case 'completed':
                return '完了';
            case 'partial':
                return '一部欠落';
            case 'failed':
                return '失敗';
            case 'canceled':
                return '中止';
            default:
                return '不明';
        }
    }
    public statusColor(status: apid.RecordingResultSession['resultStatus']): string {
        return status === 'completed' ? 'success' : status === 'partial' ? 'warning' : status === 'failed' ? 'error' : 'grey';
    }
    public reasonLabel(reason: string | undefined): string {
        return RecordingReasonUtil.getReasonLabel(reason);
    }
    public formatTimestamp(value: number | undefined): string {
        return value === undefined ? '—' : new Date(value).toLocaleString('ja-JP');
    }
    public formatBytes(value: number): string {
        return `${(value / 1024 / 1024).toFixed(1)} MB`;
    }
    public openRecorded(recordedId: apid.RecordedId): void {
        void this.$router.push(`/recorded/detail/${recordedId}`);
    }
}

export default toNative(RecordingResults);
</script>

<style lang="sass" scoped>
.result-heading
    min-width: 0
    width: 100%
.attempt-table
    overflow-x: auto
</style>
