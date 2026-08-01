<template>
    <div class="d-flex flex-wrap ga-1 series-external-links">
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
            v-if="wikidataUrl !== null"
            size="small"
            variant="outlined"
            color="blue-grey"
            :href="wikidataUrl"
            target="_blank"
            rel="noopener noreferrer"
            append-icon="mdi-open-in-new"
            title="Wikidata の項目を開く"
        >
            Wikidata
        </v-chip>
    </div>
</template>

<script lang="ts">
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../api';

/**
 * シリーズが持つ外部辞書 ID (しょぼいカレンダー / Annict / Wikidata) を
 * 元サイトの作品ページへのリンク付きチップとして並べる。
 * 録画詳細のシリーズ情報とシリーズ詳細画面の両方から使う
 */
@Component({})
class SeriesExternalLinks extends Vue {
    @Prop({ required: false, default: null })
    public externalIds!: apid.SeriesDetail['externalIds'] | null;

    /**
     * しょぼいカレンダーの作品ページ URL (syobocalTid が無ければ null)
     */
    get syobocalUrl(): string | null {
        const tid = this.externalIds?.syobocalTid;

        return typeof tid === 'number' && tid > 0 ? `https://cal.syoboi.jp/tid/${tid}` : null;
    }

    /**
     * Annict の作品ページ URL (annictId が無ければ null)
     */
    get annictUrl(): string | null {
        const id = this.externalIds?.annictId;

        return typeof id === 'string' && id !== '' ? `https://annict.com/works/${encodeURIComponent(id)}` : null;
    }

    /**
     * Wikidata の項目 URL (wikidataQid が無ければ null)
     */
    get wikidataUrl(): string | null {
        const qid = this.externalIds?.wikidataQid;

        return typeof qid === 'string' && /^Q\d+$/.test(qid) === true ? `https://www.wikidata.org/wiki/${qid}` : null;
    }
}

export default toNative(SeriesExternalLinks);
</script>
