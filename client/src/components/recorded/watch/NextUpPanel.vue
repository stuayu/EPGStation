<template>
    <v-card class="next-up-panel" variant="outlined">
        <v-card-title class="d-flex align-center justify-space-between">
            <span>Next Up</span>
            <div class="d-flex align-center">
                <v-btn v-if="data !== null && data.currentSeriesId !== null" size="small" variant="text" @click="moveSeries">シリーズへ</v-btn>
                <v-btn
                    size="small"
                    variant="text"
                    icon
                    :aria-label="panelOpen === true ? 'パネルを閉じる' : 'パネルを開く'"
                    @click="togglePanelOpen"
                >
                    <v-icon>{{ panelOpen === true ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
                </v-btn>
            </div>
        </v-card-title>
        <template v-if="panelOpen === true">
            <div v-if="showCountdown === true && countdownItem !== null" class="countdown-card pa-3">
                <div class="text-caption">次: {{ countdownItem.name }}</div>
                <div class="text-subtitle-2">{{ countdownSeconds }} 秒後に自動再生します</div>
                <v-btn size="small" variant="outlined" class="mt-1" @click="cancelCountdown">キャンセル</v-btn>
            </div>
            <v-tabs v-model="tab" density="comfortable">
                <v-tab value="latest">最新</v-tab>
                <v-tab value="series">シリーズ</v-tab>
            </v-tabs>
            <v-window v-model="tab" class="next-up-body" ref="body">
                <v-window-item value="latest">
                    <v-list lines="two" density="compact">
                        <v-list-item v-for="item in data?.latest ?? []" :key="`latest-${item.id}`">
                            <v-list-item-title>{{ item.name }}</v-list-item-title>
                            <v-list-item-subtitle>{{ item.channelName || item.channelId }} · {{ formatDate(item.startAt) }}</v-list-item-subtitle>
                            <template #append>
                                <div class="d-flex flex-column align-end" style="min-width: 72px">
                                    <v-chip v-if="watchStatusLabel(item) !== null" size="x-small" :color="watchStatusColor(item)" class="mb-1">{{ watchStatusLabel(item) }}</v-chip>
                                    <v-progress-linear v-if="watchProgress(item) !== null" :model-value="watchProgress(item) ?? 0" height="3"></v-progress-linear>
                                    <v-btn size="small" variant="text" @click="play(item)">再生</v-btn>
                                </div>
                            </template>
                        </v-list-item>
                    </v-list>
                    <div ref="latestSentinel" class="load-sentinel">
                        <v-progress-circular v-if="isLoadingMore === true && tab === 'latest'" indeterminate size="20"></v-progress-circular>
                    </div>
                </v-window-item>
                <v-window-item value="series">
                    <v-list lines="two" density="compact">
                        <v-list-item v-for="item in data?.series ?? []" :key="`series-${item.id}`">
                            <v-list-item-title>{{ episodeLabel(item) }}{{ item.name }}</v-list-item-title>
                            <v-list-item-subtitle>{{ item.channelName || item.channelId }} · {{ formatDate(item.startAt) }}</v-list-item-subtitle>
                            <template #append>
                                <div class="d-flex flex-column align-end" style="min-width: 72px">
                                    <v-chip v-if="watchStatusLabel(item) !== null" size="x-small" :color="watchStatusColor(item)" class="mb-1">{{ watchStatusLabel(item) }}</v-chip>
                                    <v-progress-linear v-if="watchProgress(item) !== null" :model-value="watchProgress(item) ?? 0" height="3"></v-progress-linear>
                                    <v-btn size="small" variant="text" @click="play(item)">再生</v-btn>
                                </div>
                            </template>
                        </v-list-item>
                    </v-list>
                    <div ref="seriesSentinel" class="load-sentinel">
                        <v-progress-circular v-if="isLoadingMore === true && tab === 'series'" indeterminate size="20"></v-progress-circular>
                    </div>
                </v-window-item>
            </v-window>
            <v-card-text v-if="!loading && empty">候補がありません</v-card-text>
        </template>
    </v-card>
</template>
<script lang="ts">
import container from '@/model/ModelContainer';
import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import ISeriesApiModel from '@/model/api/series/ISeriesApiModel';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import WatchStatusUtil from '@/util/WatchStatusUtil';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../../api';

interface NextUpData {
    currentSeriesId: number | null;
    latest: apid.RecordedItem[];
    series: apid.RecordedItem[];
    hasMoreLatest: boolean;
    hasMoreSeries: boolean;
}

@Component({})
class NextUpPanel extends Vue {
    @Prop({ required: true }) public recordedId!: apid.RecordedId;
    @Prop({ default: false }) public isHalfWidth!: boolean;
    @Prop({ default: null }) public streamingType!: string | null;
    @Prop({ default: null }) public mode!: number | null;

    public data: NextUpData | null = null;
    public loading = false;
    public isLoadingMore = false;
    public tab: 'latest' | 'series' = 'latest';
    public panelOpen = true;

    // 無限スクロール用の監視。スクロールイベントを毎フレーム処理しないよう IntersectionObserver を使う
    // (低スペックのスマートフォンでも描画を妨げないため)
    private observer: IntersectionObserver | null = null;

    // 連続再生 (§4.9) 用の状態
    public showCountdown = false;
    public countdownSeconds = 0;
    public countdownItem: apid.RecordedItem | null = null;
    private countdownCanceled = false;
    private countdownTimerId: number | null = null;
    private episodeNumberMap: Map<apid.RecordedId, number | null> = new Map();
    private currentEpisodeNumber: number | null = null;

    private api = container.get<IRecordedApiModel>('IRecordedApiModel');
    private seriesApi = container.get<ISeriesApiModel>('ISeriesApiModel');
    private settingModel = container.get<ISettingStorageModel>('ISettingStorageModel');

    private onKeydown = (e: KeyboardEvent): void => {
        if (e.key !== 'n' && e.key !== 'N') return;
        const target = e.target as HTMLElement | null;
        if (target !== null) {
            const tag = target.tagName.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || target.isContentEditable === true) return;
        }
        const next = this.resolveNextItem();
        if (next !== null) {
            this.cancelCountdown();
            this.play(next);
        }
    };

    get empty(): boolean {
        return (this.data?.latest.length ?? 0) === 0 && (this.data?.series.length ?? 0) === 0;
    }

    public created(): void {
        // §11: 開閉状態・タブ選択をクライアント設定から復元する
        this.panelOpen = this.settingModel.tmp.isNextUpPanelOpen;
        this.tab = this.settingModel.tmp.nextUpPanelTab;
        // §12: 将来のリモコン操作を見据えたキーボードショートカット (N キーで次を再生)
        document.addEventListener('keydown', this.onKeydown);
    }

    public mounted(): void {
        this.setupObserver();
    }

    public beforeUnmount(): void {
        document.removeEventListener('keydown', this.onKeydown);
        this.clearCountdownTimer();
        this.teardownObserver();
    }

    @Watch('tab')
    public onTabChange(value: 'latest' | 'series'): void {
        this.settingModel.tmp.nextUpPanelTab = value;
        this.settingModel.save();
        this.resetCountdown();
        // 表示中のタブの番兵だけを監視する
        this.$nextTick(() => {
            this.setupObserver();
        });
    }

    @Watch('panelOpen')
    public onPanelOpenChange(): void {
        // 畳んでいる間は監視も止める (見えていないリストの追加読み込みを走らせない)
        this.$nextTick(() => {
            this.setupObserver();
        });
    }

    public togglePanelOpen(): void {
        this.panelOpen = !this.panelOpen;
        this.settingModel.tmp.isNextUpPanelOpen = this.panelOpen;
        this.settingModel.save();
    }

    @Watch('recordedId', { immediate: true })
    async load(): Promise<void> {
        this.loading = true;
        this.resetCountdown();
        this.episodeNumberMap = new Map();
        this.currentEpisodeNumber = null;
        try {
            this.data = await this.api.getNextUp(this.recordedId, this.isHalfWidth, {
                limit: NextUpPanel.PAGE_SIZE,
                offset: 0,
            });
            if (this.data !== null && this.data.currentSeriesId !== null) {
                await this.loadEpisodeNumbers(this.data.currentSeriesId);
            }
        } finally {
            this.loading = false;
        }

        this.$nextTick(() => {
            this.setupObserver();
        });
    }

    /**
     * 表示中のタブの番兵要素だけを IntersectionObserver で監視する
     * 監視対象は 1 つだけに保ち、パネルを畳んでいる間や続きが無い場合は監視自体を止める
     */
    private setupObserver(): void {
        this.teardownObserver();

        if (this.panelOpen === false || typeof IntersectionObserver === 'undefined') {
            return;
        }
        if (this.hasMore(this.tab) === false) {
            return;
        }

        const sentinel = (this.tab === 'series' ? this.$refs.seriesSentinel : this.$refs.latestSentinel) as HTMLElement | undefined;
        const root = (this.$refs.body as { $el?: HTMLElement } | undefined)?.$el;
        if (typeof sentinel === 'undefined' || sentinel === null) {
            return;
        }

        this.observer = new IntersectionObserver(
            entries => {
                if (entries.some(entry => entry.isIntersecting === true) === true) {
                    void this.loadMore();
                }
            },
            {
                root: root instanceof HTMLElement ? root : null,
                // 下端に到達する少し手前で読み始める
                rootMargin: '200px',
            },
        );
        this.observer.observe(sentinel);
    }

    private teardownObserver(): void {
        if (this.observer !== null) {
            this.observer.disconnect();
            this.observer = null;
        }
    }

    /**
     * 指定タブに続きがあるか
     */
    private hasMore(tab: 'latest' | 'series'): boolean {
        if (this.data === null) {
            return false;
        }

        return tab === 'series' ? this.data.hasMoreSeries === true : this.data.hasMoreLatest === true;
    }

    /**
     * 表示中のタブの続きを 1 ページ分だけ読み込む
     * 追加読み込み中は再入しないので、番兵が何度交差しても多重リクエストにはならない
     */
    private async loadMore(): Promise<void> {
        if (this.isLoadingMore === true || this.loading === true || this.data === null) {
            return;
        }
        if (this.hasMore(this.tab) === false) {
            return;
        }

        const tab = this.tab;
        const offset = tab === 'series' ? this.data.series.length : this.data.latest.length;

        this.isLoadingMore = true;
        try {
            const result = await this.api.getNextUp(this.recordedId, this.isHalfWidth, {
                limit: NextUpPanel.PAGE_SIZE,
                offset: offset,
                target: tab,
            });
            if (result === null || this.data === null || tab !== this.tab) {
                return;
            }

            // 既に持っている録画は取り除いてから追記する (境界での重複対策)
            const current = tab === 'series' ? this.data.series : this.data.latest;
            const known = new Set(current.map(item => item.id));
            const added = (tab === 'series' ? result.series : result.latest).filter(item => known.has(item.id) === false);
            current.push(...added);

            if (tab === 'series') {
                this.data.hasMoreSeries = result.hasMoreSeries === true && added.length > 0;
            } else {
                this.data.hasMoreLatest = result.hasMoreLatest === true && added.length > 0;
            }
        } catch (err) {
            console.error(err);
            // 失敗したら監視を止めて無限リトライを避ける
            if (this.data !== null) {
                if (tab === 'series') this.data.hasMoreSeries = false;
                else this.data.hasMoreLatest = false;
            }
        } finally {
            this.isLoadingMore = false;
            this.$nextTick(() => {
                this.setupObserver();
            });
        }
    }

    /**
     * シリーズ詳細から話数マップを解決する (録画詳細レスポンス自体に seriesId/episodeNo が無いため)
     */
    private async loadEpisodeNumbers(seriesId: number): Promise<void> {
        try {
            const detail = await this.seriesApi.get(seriesId);
            const map = new Map<apid.RecordedId, number | null>();
            for (const row of detail.recorded) {
                map.set(row.recordedId, row.episodeNumber);
            }
            this.episodeNumberMap = map;
            this.currentEpisodeNumber = map.get(this.recordedId) ?? null;
        } catch (err) {
            console.error(err);
            this.episodeNumberMap = new Map();
            this.currentEpisodeNumber = null;
        }
    }

    moveSeries(): void {
        const seriesId = this.data?.currentSeriesId;
        if (seriesId !== null && typeof seriesId !== 'undefined') void this.$router.push(`/series/${seriesId}`);
    }

    private pickVideo(item: apid.RecordedItem): apid.VideoFile | null {
        return item.videoFiles?.find(x => x.type === 'encoded') ?? item.videoFiles?.[0] ?? null;
    }

    play(item: apid.RecordedItem): void {
        const video = this.pickVideo(item);
        if (video === null) {
            void this.$router.push(`/recorded/detail/${item.id}`);
            return;
        }
        if (video.type === 'encoded' && (this.streamingType === null || this.mode === null)) {
            void this.$router.push({ path: '/recorded/watch', query: { videoId: String(video.id), recordedId: String(item.id) } });
            return;
        }
        if (this.streamingType !== null && this.mode !== null) {
            void this.$router.push({ path: `/recorded/streaming/${video.id}`, query: { recordedId: String(item.id), streamingType: this.streamingType, mode: String(this.mode) } });
            return;
        }
        void this.$router.push(`/recorded/detail/${item.id}`);
    }

    private getWatchStatus(item: apid.RecordedItem): apid.WatchStatus | undefined {
        return item.videoFiles?.find(x => typeof x.watchHistory !== 'undefined')?.watchHistory?.status;
    }

    watchStatusLabel(item: apid.RecordedItem): string | null {
        return WatchStatusUtil.getLabel(this.getWatchStatus(item));
    }

    watchStatusColor(item: apid.RecordedItem): string {
        return WatchStatusUtil.getColor(this.getWatchStatus(item));
    }

    watchProgress(item: apid.RecordedItem): number | null {
        const history = item.videoFiles?.find(x => typeof x.watchHistory !== 'undefined')?.watchHistory;
        if (typeof history === 'undefined' || history.status !== 'watching' || history.duration <= 0) return null;

        return Math.min(100, Math.round((history.position / history.duration) * 100));
    }

    episodeLabel(item: apid.RecordedItem): string {
        const episodeNumber = this.episodeNumberMap.get(item.id);

        return typeof episodeNumber === 'number' ? `第${episodeNumber}話 ` : '';
    }

    formatDate(value: number): string {
        return new Date(value).toLocaleString();
    }

    /**
     * 現在のタブ選択で連続再生 (自動遷移) を行うか
     * シリーズタブは常時有効、新着タブは設定でオプトイン (既定 OFF)
     */
    private isAutoPlayEnabled(): boolean {
        if (this.tab === 'series') return (this.data?.series.length ?? 0) > 0;

        return this.settingModel.tmp.isEnableNextUpAutoPlayForLatestTab === true;
    }

    /**
     * 選択中タブから「次に再生する録画」を解決する
     * シリーズタブは話数昇順で現在より後の最小話数を優先し、無ければ未視聴優先、それも無ければ先頭
     * 新着タブは未視聴優先、無ければ先頭
     */
    private resolveNextItem(): apid.RecordedItem | null {
        const list = this.tab === 'series' ? this.data?.series ?? [] : this.data?.latest ?? [];
        if (list.length === 0) return null;

        if (this.tab === 'series') {
            const withEpisode = list
                .map(item => ({ item, episodeNumber: this.episodeNumberMap.get(item.id) ?? null }))
                .sort((a, b) => (a.episodeNumber ?? Number.MAX_SAFE_INTEGER) - (b.episodeNumber ?? Number.MAX_SAFE_INTEGER));

            if (this.currentEpisodeNumber !== null) {
                const after = withEpisode.find(x => x.episodeNumber !== null && x.episodeNumber > (this.currentEpisodeNumber as number));
                if (typeof after !== 'undefined') return after.item;
            }

            const unwatched = list.find(item => this.getWatchStatus(item) !== 'watched');
            if (typeof unwatched !== 'undefined') return unwatched;

            return withEpisode[0]?.item ?? list[0];
        }

        const unwatched = list.find(item => this.getWatchStatus(item) !== 'watched');

        return unwatched ?? list[0];
    }

    /**
     * VideoContainer からの残り再生時間通知 (連続再生のカウントダウン開始判定)
     * @param remainingSeconds: number
     */
    public onVideoRemainingTime(remainingSeconds: number): void {
        if (this.countdownCanceled === true || this.showCountdown === true) return;
        if (this.isAutoPlayEnabled() === false) return;
        if (remainingSeconds > NextUpPanel.COUNTDOWN_TRIGGER_SECONDS) return;

        const next = this.resolveNextItem();
        if (next !== null) this.startCountdown(next);
    }

    /**
     * VideoContainer からの再生終了通知
     * カウントダウンが既に走っている場合はそちらに処理を任せ、
     * 動画が短くカウントダウンが発火しなかった場合のみ即座に次へ遷移する
     */
    public onVideoEnded(): void {
        if (this.showCountdown === true || this.countdownCanceled === true) return;
        if (this.isAutoPlayEnabled() === false) return;

        const next = this.resolveNextItem();
        if (next !== null) this.play(next);
    }

    private startCountdown(next: apid.RecordedItem): void {
        this.countdownItem = next;
        this.countdownSeconds = NextUpPanel.COUNTDOWN_DURATION_SECONDS;
        this.showCountdown = true;
        this.clearCountdownTimer();
        this.countdownTimerId = window.setInterval(() => {
            this.countdownSeconds -= 1;
            if (this.countdownSeconds <= 0) {
                this.clearCountdownTimer();
                const target = this.countdownItem;
                this.showCountdown = false;
                if (target !== null) this.play(target);
            }
        }, 1000);
    }

    public cancelCountdown(): void {
        this.countdownCanceled = true;
        this.showCountdown = false;
        this.clearCountdownTimer();
    }

    private resetCountdown(): void {
        this.countdownCanceled = false;
        this.showCountdown = false;
        this.countdownItem = null;
        this.clearCountdownTimer();
    }

    private clearCountdownTimer(): void {
        if (this.countdownTimerId !== null) {
            window.clearInterval(this.countdownTimerId);
            this.countdownTimerId = null;
        }
    }
}

namespace NextUpPanel {
    export const COUNTDOWN_TRIGGER_SECONDS = 8;
    export const COUNTDOWN_DURATION_SECONDS = 8;
    // 1 回の読み込み件数。DOM を一度に増やしすぎないよう小さめに取る
    export const PAGE_SIZE = 20;
}

export default toNative(NextUpPanel);
</script>
<style lang="sass" scoped>
// 視聴画面の右パネルに置かれたときは親の高さに収め、リスト部だけをスクロールさせる
// (親に高さの制約が無い画面では max-height が効かないため、従来通り中身の分だけ伸びる)
.next-up-panel
    width: 360px
    max-width: 100%
    max-height: 100%
    display: flex
    flex-direction: column

    > .v-card-title,
    .countdown-card,
    .v-tabs
        flex-shrink: 0

.next-up-panel .next-up-body
    flex: 1 1 auto
    min-height: 0
    overflow-y: auto

// 無限スクロールの番兵。高さを持たせて rootMargin と合わせて先読みさせる
.load-sentinel
    display: flex
    align-items: center
    justify-content: center
    height: 32px

.countdown-card
    background: rgba(var(--v-theme-primary), 0.08)
</style>
