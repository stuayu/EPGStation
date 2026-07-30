<template>
    <v-card v-if="isEnabled === true && mapping !== null && detail !== null" variant="outlined" class="recorded-detail-series pa-3">
        <div class="text-caption text-grey mb-2">シリーズ情報</div>
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
                <router-link :to="`/series/${detail.id}`" class="series-title text-subtitle-1 font-weight-bold">
                    {{ detail.title }}
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
                    <v-chip
                        v-if="annictUrl !== null"
                        size="small"
                        variant="outlined"
                        color="green"
                        :href="annictUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        append-icon="mdi-open-in-new"
                        title="Annict の作品ページを開く"
                    >
                        Annict
                    </v-chip>
                    <v-chip
                        v-if="syobocalUrl !== null"
                        size="small"
                        variant="outlined"
                        color="orange"
                        :href="syobocalUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        append-icon="mdi-open-in-new"
                        title="しょぼいカレンダーの作品ページを開く"
                    >
                        しょぼいカレンダー
                    </v-chip>
                </div>
            </div>
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
    </v-card>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import ISeriesApiModel, { SeriesDetail, SeriesMapping, SeriesRecording } from '@/model/api/series/ISeriesApiModel';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import { isFeatureEnabled } from '@/util/FeatureFlags';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../../api';

/**
 * 録画詳細画面にシリーズ情報 (辞書由来のクール・外部 ID・話数) と
 * 同一シリーズの関連録画一覧を表示する
 * シリーズ機能 (featureFlags.seriesLibrary) が無効な場合、および
 * 当該録画がどのシリーズにも紐づいていない場合は何も表示しない
 */
@Component({})
class RecordedDetailSeries extends Vue {
    @Prop({ required: true })
    public recordedId!: apid.RecordedId;

    private api: ISeriesApiModel = container.get<ISeriesApiModel>('ISeriesApiModel');
    private serverConfig: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');

    public mapping: SeriesMapping | null = null;
    public detail: SeriesDetail | null = null;

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

    /**
     * Annict の作品ページ URL (annictId が無ければ null)
     */
    get annictUrl(): string | null {
        const id = this.detail?.externalIds?.annictId;
        return typeof id === 'string' && id !== '' ? `https://annict.com/works/${encodeURIComponent(id)}` : null;
    }

    /**
     * しょぼいカレンダーの作品ページ URL (syobocalTid が無ければ null)
     */
    get syobocalUrl(): string | null {
        const tid = this.detail?.externalIds?.syobocalTid;
        return typeof tid === 'number' && tid > 0 ? `https://cal.syoboi.jp/tid/${tid}` : null;
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

    .series-title
        text-decoration: none
        color: inherit

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
