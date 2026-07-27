<template>
    <DashboardItem title="録り逃しアラート">
        <template v-slot:items>
            <div class="px-2 pb-2">
                <v-progress-circular v-if="isLoading === true" indeterminate size="24" class="ma-2"></v-progress-circular>
                <div v-else-if="alerts.length === 0" class="pa-2 text-caption">欠番はありません</div>
                <v-list v-else lines="two" density="compact">
                    <v-list-item v-for="alert in alerts" :key="alert.seriesId" v-on:click="gotoSeries(alert.seriesId)">
                        <v-list-item-title>{{ alert.title }}</v-list-item-title>
                        <v-list-item-subtitle>欠番 {{ alert.missingCount }} 件 (再放送候補あり)</v-list-item-subtitle>
                    </v-list-item>
                </v-list>
            </div>
        </template>
    </DashboardItem>
</template>

<script lang="ts">
import DashboardItem from '@/components/dashboard/DashboardItem.vue';
import container from '@/model/ModelContainer';
import ISeriesApiModel from '@/model/api/series/ISeriesApiModel';
import Util from '@/util/Util';
import { Component, Vue, toNative } from 'vue-facing-decorator';

interface MissingEpisodeAlert {
    seriesId: number;
    title: string;
    missingCount: number;
}

@Component({
    components: {
        DashboardItem,
    },
})
class DashboardMissingEpisodeCard extends Vue {
    public alerts: MissingEpisodeAlert[] = [];
    public isLoading: boolean = true;

    private seriesApiModel: ISeriesApiModel = container.get<ISeriesApiModel>('ISeriesApiModel');

    public async created(): Promise<void> {
        await this.fetchData();
    }

    /**
     * 直近更新されたシリーズを対象に欠番の有無を調べる
     * シリーズ横断で欠番一覧を返すサーバー API が無いため、直近更新分のみをスキャンする軽量実装
     */
    public async fetchData(): Promise<void> {
        this.isLoading = true;
        try {
            const list = await this.seriesApiModel.list({ offset: 0, limit: DashboardMissingEpisodeCard.SCAN_SERIES_LIMIT });
            const results: MissingEpisodeAlert[] = [];

            for (const series of list.items) {
                try {
                    const proposals = await this.seriesApiModel.getMissingEpisodeProposals(series.id);
                    if (proposals.length > 0) {
                        results.push({
                            seriesId: series.id,
                            title: series.title,
                            missingCount: proposals.length,
                        });
                    }
                } catch (err) {
                    // 1 シリーズの取得失敗で全体を止めない
                    console.error(err);
                }

                if (results.length >= DashboardMissingEpisodeCard.MAX_ALERTS) {
                    break;
                }
            }

            this.alerts = results;
        } catch (err) {
            console.error(err);
            this.alerts = [];
        } finally {
            this.isLoading = false;
        }
    }

    public gotoSeries(seriesId: number): void {
        Util.move(this.$router, { path: `/series/${seriesId}` });
    }
}

namespace DashboardMissingEpisodeCard {
    export const SCAN_SERIES_LIMIT = 15;
    export const MAX_ALERTS = 10;
}

export default toNative(DashboardMissingEpisodeCard);
</script>
