<template>
    <v-card v-if="isEnabled === true" variant="outlined" class="recorded-detail-series pa-3">
        <div class="d-flex align-center justify-space-between mb-2">
            <div class="text-caption text-grey">シリーズ情報</div>
            <v-btn size="small" variant="text" :loading="isAnalyzing === true" @click="analyze">
                シリーズ判定を実行
            </v-btn>
        </div>

        <div v-if="mapping === null || detail === null" class="text-body-2 text-grey">
            この録画はまだシリーズに紐づいていません
        </div>

        <template v-else>
        <div class="series-head">
            <v-img
                v-if="detail.hasImage === true"
                :src="`./api/series/${detail.id}/image`"
                cover
                class="series-image rounded"
            >
                <template v-slot:error>
                    <div class="d-flex align-center justify-center fill-height">
                        <v-icon size="24" color="grey">mdi-image-off-outline</v-icon>
                    </div>
                </template>
            </v-img>
            <div class="series-meta">
                <!-- タイトル自体もシリーズ詳細へのリンクだが、リンクと分かるよう下線とアイコンを付ける -->
                <router-link :to="`/series/${detail.id}`" class="series-title text-subtitle-1 font-weight-bold">
                    {{ detail.title }}
                    <v-icon size="small">mdi-chevron-right</v-icon>
                </router-link>
                <div class="d-flex flex-wrap ga-1 mt-1">
                    <v-chip size="small" variant="tonal" :color="detail.origin === 'dictionary' ? 'teal' : 'grey'">
                        {{ detail.origin === 'dictionary' ? '作品辞書' : 'シリーズ' }}
                    </v-chip>
                    <v-chip v-if="seasonText !== null" size="small" variant="tonal" color="indigo">{{ seasonText }}</v-chip>
                    <v-chip v-if="episodeText !== null" size="small" variant="tonal" color="blue">{{ episodeText }}</v-chip>
                    <v-chip v-if="mapping.airType !== 'first' && mapping.airType !== 'unknown'" size="small" variant="tonal" :color="airTypeColor(mapping.airType)">
                        {{ airTypeLabel(mapping.airType) }}
                    </v-chip>
                    <!-- 外部辞書のタグは元サイトの作品ページへ遷移する (別タブ) -->
                    <SeriesExternalLinks :externalIds="detail.externalIds"></SeriesExternalLinks>
                </div>
                <!-- シリーズ詳細への導線。チップ列に埋もれないようボタンとして独立させる -->
                <v-btn
                    class="mt-2"
                    size="small"
                    variant="tonal"
                    color="primary"
                    prepend-icon="mdi-video-box"
                    :to="`/series/${detail.id}`"
                >
                    シリーズ詳細を開く
                </v-btn>
            </div>
        </div>

        <!-- 放送回コメント (しょぼいカレンダーの ProgComment 由来 / 手動編集) -->
        <div v-if="mapping.episodeComment" class="mt-3">
            <div class="text-caption text-grey mb-1">
                この回のコメント
                <v-chip v-if="mapping.episodeCommentSource === 'manual'" size="x-small" color="primary">手動</v-chip>
            </div>
            <SyobocalComment :comment="mapping.episodeComment"></SyobocalComment>
        </div>

        <!-- 作品コメント。長文なので既定では折りたたむ -->
        <div v-if="detail.comment" class="mt-3">
            <div class="text-caption text-grey mb-1">
                作品コメント
                <v-chip v-if="detail.commentSource === 'manual'" size="x-small" color="primary">手動</v-chip>
            </div>
            <SyobocalComment :comment="detail.comment" :collapsible="true"></SyobocalComment>
        </div>

        <div v-if="relatedRecorded.length > 0" class="mt-3">
            <div class="text-caption text-grey mb-1">同じシリーズの録画 ({{ detail.recordedCount }} 件)</div>
            <v-list density="compact" class="related-list">
                <v-list-item
                    v-for="r in relatedRecorded"
                    :key="r.recordedId"
                    :to="`/recorded/detail/${r.recordedId}`"
                    density="compact"
                >
                    <v-list-item-title class="text-body-2">
                        {{ episodeLabel(r) }}{{ r.episodeTitle || r.recordedTitle }}
                    </v-list-item-title>
                    <v-list-item-subtitle class="text-caption">
                        {{ r.channelName || r.channelId }} ・ {{ formatDate(r.startAt) }}
                    </v-list-item-subtitle>
                </v-list-item>
            </v-list>
            <v-btn v-if="detail.recordedCount > relatedRecorded.length + 1" size="small" variant="text" :to="`/series/${detail.id}`">
                すべて見る ({{ detail.recordedCount }} 件)
            </v-btn>
        </div>
        </template>

        <SeriesAnalyzeDialog
            v-model="isAnalyzeDialogOpen"
            :result="analyzeResult"
            :isRunning="isAnalyzing"
            :errorMessage="analyzeError"
        ></SeriesAnalyzeDialog>
    </v-card>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import ISeriesApiModel, { SeriesAnalyzeResult, SeriesDetail, SeriesMapping, SeriesRecording } from '@/model/api/series/ISeriesApiModel';
import SeriesExternalLinks from '@/components/series/SeriesExternalLinks.vue';
import SyobocalComment from '@/components/series/SyobocalComment.vue';
import SeriesAnalyzeDialog from './SeriesAnalyzeDialog.vue';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import { isFeatureEnabled } from '@/util/FeatureFlags';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../../api';

/**
 * 録画詳細画面にシリーズ情報 (辞書由来のクール・外部 ID・話数) と
 * 同一シリーズの関連録画一覧を表示する。
 * シリーズ機能 (featureFlags.seriesLibrary) が無効な場合は何も表示しない。
 * どのシリーズにも紐づいていない録画でも、この録画 1 件だけシリーズ判定を実行する
 * ボタンは表示する (判定過程は SeriesAnalyzeDialog で確認できる)
 */
@Component({
    components: { SeriesAnalyzeDialog, SeriesExternalLinks, SyobocalComment },
})
class RecordedDetailSeries extends Vue {
    @Prop({ required: true })
    public recordedId!: apid.RecordedId;

    private api: ISeriesApiModel = container.get<ISeriesApiModel>('ISeriesApiModel');
    private serverConfig: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');

    public mapping: SeriesMapping | null = null;
    public detail: SeriesDetail | null = null;

    // シリーズ判定 (単発実行) の状態
    public isAnalyzeDialogOpen: boolean = false;
    public isAnalyzing: boolean = false;
    public analyzeResult: SeriesAnalyzeResult | null = null;
    public analyzeError: string | null = null;

    private static readonly RELATED_MAX = 8;

    get isEnabled(): boolean {
        return isFeatureEnabled(this.serverConfig.getConfig(), 'seriesLibrary');
    }

    get seasonText(): string | null {
        if (this.detail === null || typeof this.detail.seasonYear !== 'number') {
            return null;
        }
        const seasonNameText: { [key: string]: string } = { WINTER: '冬', SPRING: '春', SUMMER: '夏', AUTUMN: '秋' };
        const name = this.detail.seasonName ? (seasonNameText[this.detail.seasonName] ?? '') : '';
        return `${this.detail.seasonYear}年${name}クール`;
    }

    get episodeText(): string | null {
        if (this.mapping === null || this.mapping.episodeNumber === null) {
            return null;
        }
        return typeof this.mapping.seasonNumber === 'number' && this.mapping.seasonNumber > 1
            ? `S${this.mapping.seasonNumber} 第${this.mapping.episodeNumber}話`
            : `第${this.mapping.episodeNumber}話`;
    }

    get relatedRecorded(): SeriesRecording[] {
        if (this.detail === null) {
            return [];
        }

        return this.detail.recorded
            .filter(r => r.recordedId !== this.recordedId)
            .sort((a, b) => b.startAt - a.startAt)
            .slice(0, RecordedDetailSeries.RELATED_MAX);
    }

    public episodeLabel(r: SeriesRecording): string {
        if (r.episodeLabel) {
            return `${r.episodeLabel} `;
        }
        if (r.episodeNumber !== null) {
            return `第${r.episodeNumber}話 `;
        }
        return '';
    }

    public airTypeLabel(airType: string): string {
        switch (airType) {
            case 'rerun':
                return '再放送';
            case 'delayed':
                return '遅れ放送';
            default:
                return '不明';
        }
    }

    public airTypeColor(airType: string): string {
        switch (airType) {
            case 'rerun':
                return 'orange';
            case 'delayed':
                return 'purple';
            default:
                return 'grey';
        }
    }

    public formatDate(value: number): string {
        return new Date(value).toLocaleString();
    }

    /**
     * この録画 1 件だけシリーズ判定を実行し、判定過程を含む結果をダイアログに表示する
     */
    public async analyze(): Promise<void> {
        this.analyzeResult = null;
        this.analyzeError = null;
        this.isAnalyzing = true;
        this.isAnalyzeDialogOpen = true;
        try {
            this.analyzeResult = await this.api.analyze(this.recordedId);
            // 判定結果をその場で画面へ反映する
            await this.fetchData();
        } catch (err) {
            console.error(err);
            this.analyzeError = 'シリーズ判定に失敗しました';
        } finally {
            this.isAnalyzing = false;
        }
    }

    public created(): void {
        void this.fetchData();
    }

    @Watch('recordedId')
    public onRecordedIdChange(): void {
        void this.fetchData();
    }

    private async fetchData(): Promise<void> {
        this.mapping = null;
        this.detail = null;

        if (this.isEnabled === false) {
            return;
        }

        try {
            const mapping = await this.api.getMapping(this.recordedId);
            if (mapping === null) {
                return;
            }
            this.mapping = mapping;
            this.detail = await this.api.get(mapping.seriesId);
        } catch (err) {
            // シリーズ情報が取得できなくても録画詳細自体の表示は継続する
            console.error(err);
        }
    }
}

export default toNative(RecordedDetailSeries);
</script>

<style lang="sass" scoped>
// 自身の幅に応じてレイアウトを変える (上部表示 = 横並び / 右サイドバー = 縦積み)
.recorded-detail-series
    container-type: inline-size

    .series-head
        display: flex
        align-items: flex-start
        gap: 12px

    .series-image
        flex: 0 0 96px
        width: 96px
        height: 54px
        overflow: hidden

    .series-meta
        flex: 1 1 auto
        min-width: 0

    // シリーズ詳細への遷移だと分かるようリンク色 + 下線にする
    .series-title
        display: inline-flex
        align-items: center
        gap: 2px
        text-decoration: underline
        text-underline-offset: 2px
        color: rgb(var(--v-theme-primary))

    .related-list
        max-height: 320px
        overflow-y: auto

    // サイドバー幅など狭いときは画像を上に回して横幅一杯に伸ばす
    @container (max-width: 360px)
        .series-head
            flex-direction: column

        .series-image
            flex: 0 0 auto
            width: 100%
            height: auto
            aspect-ratio: 16 / 9
</style>
