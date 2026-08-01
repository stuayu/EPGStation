<template>
    <v-dialog v-model="isOpen" max-width="900" scrollable>
        <v-card>
            <v-card-title class="text-subtitle-1">シリーズ判定の結果</v-card-title>
            <v-card-text>
                <div v-if="isRunning === true" class="d-flex align-center ga-3 py-4">
                    <v-progress-circular indeterminate size="24"></v-progress-circular>
                    <span>判定中… (外部の作品辞書・放送予定へ問い合わせています)</span>
                </div>

                <v-alert v-else-if="errorMessage !== null" type="error" class="mb-2">{{ errorMessage }}</v-alert>

                <template v-else-if="result !== null">
                    <div class="text-body-2 mb-1">{{ result.title }}</div>
                    <div class="d-flex flex-wrap ga-1 mb-3">
                        <v-chip v-if="result.manualLock === true" size="small" color="primary">手動確定済み</v-chip>
                        <v-chip v-else-if="result.linked === true" size="small" color="success">
                            {{ result.seriesTitle }} (確度 {{ Math.round((result.confidence ?? 0) * 100) }}%)
                        </v-chip>
                        <v-chip v-else-if="result.pending === true" size="small" color="warning">未確定キューへ</v-chip>
                        <v-chip v-else size="small" color="grey">シリーズ化されず</v-chip>
                        <v-chip v-if="result.episodeNumber !== null" size="small" variant="tonal" color="blue">
                            第{{ result.episodeNumber }}話{{ result.episodeTitle ? ` ${result.episodeTitle}` : '' }}
                        </v-chip>
                        <v-chip v-if="result.matchMethod !== null" size="small" variant="outlined">
                            判定方法: {{ result.matchMethod }}
                        </v-chip>
                    </div>

                    <v-table density="compact">
                        <thead>
                            <tr>
                                <th>照会</th>
                                <th>入力</th>
                                <th>戻り値</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(step, i) in result.steps" :key="i">
                                <td class="step-cell">
                                    <v-icon size="16" :color="step.matched === true ? 'success' : 'grey'">
                                        {{ step.matched === true ? 'mdi-check-circle' : 'mdi-minus-circle-outline' }}
                                    </v-icon>
                                    {{ step.label }}
                                </td>
                                <td class="wrap-cell">{{ step.input }}</td>
                                <td class="wrap-cell">
                                    {{ step.output }}
                                    <v-btn v-if="step.detail" size="x-small" variant="text" @click="toggleDetail(i)">
                                        {{ openedDetails.includes(i) === true ? '生データを隠す' : '生データ' }}
                                    </v-btn>
                                    <pre v-if="openedDetails.includes(i) === true" class="detail">{{ step.detail }}</pre>
                                </td>
                            </tr>
                        </tbody>
                    </v-table>
                    <div v-if="result.steps.length === 0" class="text-caption mt-2">判定ステップの記録がありません</div>
                </template>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn variant="text" @click="isOpen = false">閉じる</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import { SeriesAnalyzeResult } from '@/model/api/series/ISeriesApiModel';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';

/**
 * 録画 1 件のシリーズ判定結果 (各照会の入力と戻り値) を表示するダイアログ。
 * どの外部照会に何を投げて何が返ったかをそのまま並べ、判定がずれた原因を追えるようにする
 */
@Component({})
class SeriesAnalyzeDialog extends Vue {
    @Prop({ required: true })
    public modelValue!: boolean;

    @Prop({ required: false, default: null })
    public result!: SeriesAnalyzeResult | null;

    @Prop({ required: false, default: false })
    public isRunning!: boolean;

    @Prop({ required: false, default: null })
    public errorMessage!: string | null;

    public openedDetails: number[] = [];

    get isOpen(): boolean {
        return this.modelValue;
    }

    set isOpen(value: boolean) {
        this.$emit('update:modelValue', value);
    }

    @Watch('result')
    public onResultChange(): void {
        this.openedDetails = [];
    }

    public toggleDetail(index: number): void {
        this.openedDetails = this.openedDetails.includes(index)
            ? this.openedDetails.filter(i => i !== index)
            : [...this.openedDetails, index];
    }
}

export default toNative(SeriesAnalyzeDialog);
</script>

<style lang="sass" scoped>
.step-cell
    white-space: nowrap

.wrap-cell
    word-break: break-word
    max-width: 380px

.detail
    white-space: pre-wrap
    word-break: break-all
    font-size: 11px
    margin-top: 4px
</style>
