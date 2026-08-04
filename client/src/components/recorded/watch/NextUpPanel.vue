<template>
    <div class="next-up-panel">
        <div v-if="showCountdown === true && countdownItem !== null" class="countdown pa-3">
            <div class="text-caption">次: {{ countdownItem.name }}</div>
            <div class="text-subtitle-2">{{ countdownSeconds }} 秒後に自動再生します</div>
            <v-btn size="small" variant="outlined" class="mt-1" @click="cancelCountdown">キャンセル</v-btn>
        </div>
        <div class="head px-3 pt-3 d-flex align-center justify-space-between">
            <div class="switch">
                <button type="button" class="switch-item" v-bind:class="{ selected: tab === 'latest' }" v-on:click="tab = 'latest'">最新</button>
                <button type="button" class="switch-item" v-bind:class="{ selected: tab === 'series' }" v-on:click="tab = 'series'">シリーズ</button>
            </div>
            <v-btn v-if="data !== null && data.currentSeriesId !== null" size="small" variant="text" @click="moveSeries">シリーズへ</v-btn>
        </div>
        <div class="body" ref="body">
            <div v-show="tab === 'latest'">
                <div v-for="item in data?.latest ?? []" :key="`latest-${item.id}`" class="item" v-on:click="play(item)">
                    <v-img :src="thumbnailPath(item)" width="96" height="54" cover class="thumbnail"></v-img>
                    <div class="detail">
                        <div class="text-body-2 name">{{ item.name }}</div>
                        <div class="text-caption sub">{{ channelName(item) }} · {{ formatDate(item.startAt) }}</div>
                        <div class="status">
                            <span v-if="watchStatusLabel(item) !== null" class="text-caption" v-bind:class="`text-${watchStatusColor(item)}`">{{ watchStatusLabel(item) }}</span>
                            <v-progress-linear v-if="watchProgress(item) !== null" :model-value="watchProgress(item) ?? 0" height="3" class="progress"></v-progress-linear>
                        </div>
                    </div>
                    <v-btn size="small" variant="text" icon aria-label="再生" v-on:click.stop="play(item)">
                        <v-icon>mdi-play</v-icon>
                    </v-btn>
                </div>
                <div ref="latestSentinel" class="load-sentinel">
                    <v-progress-circular v-if="isLoadingMore === true && tab === 'latest'" indeterminate size="20"></v-progress-circular>
                </div>
            </div>
            <div v-show="tab === 'series'">
                <div v-for="item in data?.series ?? []" :key="`series-${item.id}`" class="item" v-on:click="play(item)">
                    <v-img :src="thumbnailPath(item)" width="96" height="54" cover class="thumbnail"></v-img>
                    <div class="detail">
                        <div class="text-body-2 name">{{ episodeLabel(item) }}{{ item.name }}</div>
                        <div class="text-caption sub">{{ channelName(item) }} · {{ formatDate(item.startAt) }}</div>
                        <div class="status">
                            <span v-if="watchStatusLabel(item) !== null" class="text-caption" v-bind:class="`text-${watchStatusColor(item)}`">{{ watchStatusLabel(item) }}</span>
                            <v-progress-linear v-if="watchProgress(item) !== null" :model-value="watchProgress(item) ?? 0" height="3" class="progress"></v-progress-linear>
                        </div>
                    </div>
                    <v-btn size="small" variant="text" icon aria-label="再生" v-on:click.stop="play(item)">
                        <v-icon>mdi-play</v-icon>
                    </v-btn>
                </div>
                <div ref="seriesSentinel" class="load-sentinel">
                    <v-progress-circular v-if="isLoadingMore === true && tab === 'series'" indeterminate size="20"></v-progress-circular>
                </div>
            </div>
            <div v-if="loading === false && empty === true" class="text-body-2 empty pa-3">候補がありません</div>
        </div>
    </div>
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
        // §11: タブ選択をクライアント設定から復元する
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
     * 監視対象は 1 つだけに保ち、続きが無い場合は監視自体を止める
     */
    private setupObserver(): void {
        this.teardownObserver();

        if (typeof IntersectionObserver === 'undefined') {
            return;
        }
        if (this.hasMore(this.tab) === false) {
            return;
        }

        const sentinel = (this.tab === 'series' ? this.$refs.seriesSentinel : this.$refs.latestSentinel) as HTMLElement | undefined;
        const root = this.$refs.body as HTMLElement | undefined;
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
                root: typeof root === 'undefined' ? null : root,
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

    /**
     * サムネイル画像の URL (無い場合は代替画像)
     */
    thumbnailPath(item: apid.RecordedItem): string {
        return typeof item.thumbnails === 'undefined' || item.thumbnails.length === 0 ? './img/noimg.png' : `./api/thumbnails/${item.thumbnails[0]}`;
    }

    /**
     * 放送局名 (TS 解析の局名を優先する)
     */
    channelName(item: apid.RecordedItem): string {
        return item.tsChannelName ?? item.channelName ?? String(item.channelId);
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
        const list = this.tab === 'series' ? (this.data?.series ?? []) : (this.data?.latest ?? []);
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
// 視聴画面の右パネル内に置かれる前提のレイアウト・配色 (番組情報タブに合わせる)
.next-up-panel
    display: flex
    flex-direction: column
    width: 100%
    height: 100%
    min-height: 0
    color: var(--watch-fg)

    .countdown,
    .head
        flex-shrink: 0

    .countdown
        background: rgba(var(--v-theme-primary), 0.16)

    .switch
        display: flex
        gap: 4px

    .switch-item
        padding: 4px 10px
        border-radius: 14px
        font-size: 0.75rem
        color: var(--watch-fg-dim)
        background: var(--watch-surface-chip)
        cursor: pointer

        &:hover
            color: var(--watch-fg)

        &.selected
            color: rgb(var(--v-theme-primary))
            background: rgba(var(--v-theme-primary), 0.16)

    .body
        flex: 1 1 auto
        min-height: 0
        overflow-y: auto
        padding: 4px 0

    .item
        display: flex
        align-items: center
        gap: 10px
        padding: 8px 12px
        cursor: pointer

        &:hover
            background: var(--watch-surface-hover)

    .thumbnail
        flex: 0 0 auto
        border-radius: 4px

    .detail
        flex: 1 1 auto
        min-width: 0

    .name
        display: -webkit-box
        -webkit-line-clamp: 2
        -webkit-box-orient: vertical
        overflow: hidden

    .sub
        color: var(--watch-fg-dim)
        white-space: nowrap
        overflow: hidden
        text-overflow: ellipsis

    .status
        display: flex
        align-items: center
        gap: 6px

    .progress
        max-width: 80px

    .empty
        color: var(--watch-fg-dim)

// 無限スクロールの番兵。高さを持たせて rootMargin と合わせて先読みさせる
.load-sentinel
    display: flex
    align-items: center
    justify-content: center
    height: 32px
</style>
