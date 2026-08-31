<template>
    <div>
        <div class="text-body-2 mb-3">通常は変更する必要はありません</div>
        <div class="d-flex ga-2 flex-wrap mb-3">
            <v-select v-model="selectedBuiltin" :items="builtinItems" label="複製元" hint="組み込みプリセットを初期値として複製します" persistent-hint style="flex: 1 1 220px"></v-select>
            <v-btn min-width="44" min-height="44" variant="outlined" @click="cloneBuiltin">複製</v-btn>
            <v-btn min-width="44" min-height="44" color="primary" @click="newPreset">新規作成</v-btn>
        </div>
        <v-alert v-if="items.length === 0" type="info" variant="tonal">カスタムプリセットはありません</v-alert>
        <v-card v-for="item in items" :key="item.id" variant="outlined" class="mb-3">
            <v-card-text>
                <div class="d-flex ga-2 flex-wrap">
                    <v-text-field v-model="item.name" label="名前" hint="再生画質の一覧に表示する名前" persistent-hint style="flex: 1 1 220px"></v-text-field>
                    <v-select v-model="item.useFor" :items="useForItems" label="用途" hint="ライブ・録画再生への適用範囲" persistent-hint style="flex: 1 1 180px"></v-select>
                    <v-select v-model="item.container" :items="containerItems" label="配信種別" hint="詳細設定です" persistent-hint style="flex: 0 1 180px"></v-select>
                </div>
                <div class="d-flex ga-2 flex-wrap">
                    <v-select v-model="item.resolution" :items="resolutionItems" label="解像度" hint="出力解像度" persistent-hint style="flex: 1 1 150px"></v-select>
                    <v-select v-model="item.codec" :items="codecItems" label="Codec" hint="映像コーデック" persistent-hint style="flex: 1 1 150px"></v-select>
                    <v-select v-model="item.bitDepth" :items="bitDepthItems" label="Bit Depth" hint="映像ビット深度" persistent-hint style="flex: 1 1 150px"></v-select>
                    <v-select v-model="item.frameRate" :items="frameRateItems" label="FPS" hint="出力フレームレート" persistent-hint style="flex: 1 1 150px"></v-select>
                </div>
                <div class="d-flex ga-2 flex-wrap">
                    <v-select v-model="item.hdrMode" :items="hdrItems" label="HDR" hint="HDRの扱い" persistent-hint style="flex: 1 1 150px"></v-select>
                    <v-select v-model="item.videoCorrection" :items="correctionItems" label="映像補正" hint="明るさ・走査線の補正" persistent-hint style="flex: 1 1 180px"></v-select>
                    <v-text-field v-model="item.encoder" label="エンコーダ" hint="例: libx264, libx265" persistent-hint style="flex: 1 1 180px"></v-text-field>
                    <v-select v-model="item.quality" :items="qualityItems" label="品質" hint="プリセットの品質分類" persistent-hint style="flex: 1 1 150px"></v-select>
                </div>
                <v-expansion-panels variant="accordion" class="mt-2">
                    <v-expansion-panel title="さらに詳細">
                        <v-expansion-panel-text>
                            <div class="d-flex ga-2 flex-wrap">
                                <v-text-field v-model="item.options.profile" label="Profile" hint="エンコーダプロファイル" persistent-hint style="flex: 1 1 140px"></v-text-field>
                                <v-text-field v-model="item.options.level" label="Level" hint="コーデックレベル" persistent-hint style="flex: 1 1 140px"></v-text-field>
                                <v-text-field v-model="item.options.rateControl" label="Rate Control" hint="例: CBR, VBR, QVBR" persistent-hint style="flex: 1 1 160px"></v-text-field>
                                <v-text-field v-model.number="item.options.bitrate" type="number" label="Bitrate" hint="kbps" persistent-hint style="flex: 1 1 130px"></v-text-field>
                                <v-text-field v-model.number="item.options.maxBitrate" type="number" label="Max Bitrate" hint="kbps" persistent-hint style="flex: 1 1 130px"></v-text-field>
                                <v-text-field v-model.number="item.options.crf" type="number" label="CRF" hint="品質値" persistent-hint style="flex: 1 1 110px"></v-text-field>
                                <v-text-field v-model.number="item.options.qvbr" type="number" label="QVBR" hint="品質値" persistent-hint style="flex: 1 1 110px"></v-text-field>
                                <v-text-field v-model.number="item.options.cqp" type="number" label="CQP" hint="品質値" persistent-hint style="flex: 1 1 110px"></v-text-field>
                                <v-text-field v-model.number="item.options.gop" type="number" label="GOP" hint="フレーム数" persistent-hint style="flex: 1 1 110px"></v-text-field>
                                <v-text-field v-model.number="item.options.bFrames" type="number" label="B Frames" hint="Bフレーム数" persistent-hint style="flex: 1 1 110px"></v-text-field>
                                <v-text-field v-model.number="item.options.lookahead" type="number" label="Lookahead" hint="先読みフレーム数" persistent-hint style="flex: 1 1 130px"></v-text-field>
                                <v-text-field v-model.number="item.options.aq" type="number" label="AQ" hint="適応量子化" persistent-hint style="flex: 1 1 110px"></v-text-field>
                                <v-select v-model="item.deinterlace" :items="deinterlaceItems" label="Deinterlace" hint="インターレース解除" persistent-hint style="flex: 1 1 150px"></v-select>
                                <v-text-field v-model="item.options.pixelFormat" label="Pixel Format" hint="例: yuv420p" persistent-hint style="flex: 1 1 150px"></v-text-field>
                                <v-text-field v-model="item.options.colorPrimaries" label="Color Primaries" hint="例: bt2020" persistent-hint style="flex: 1 1 160px"></v-text-field>
                                <v-text-field v-model="item.options.transfer" label="Transfer" hint="例: smpte2084" persistent-hint style="flex: 1 1 150px"></v-text-field>
                                <v-text-field v-model="item.options.toneMapping" label="Tone Mapping" hint="HDR→SDR変換方式" persistent-hint style="flex: 1 1 160px"></v-text-field>
                            </div>
                            <v-textarea v-model="item.options.additionalArguments" label="追加引数" hint="自動生成コマンドへ追加する引数" persistent-hint rows="2"></v-textarea>
                            <v-textarea v-model="item.rawCommand" label="Raw Command" hint="指定時は自動生成コマンドより優先されます。プレースホルダーを使用できます" persistent-hint rows="3"></v-textarea>
                        </v-expansion-panel-text>
                    </v-expansion-panel>
                </v-expansion-panels>
                <div class="d-flex ga-2 flex-wrap justify-end mt-2">
                    <v-btn min-width="44" min-height="44" color="error" variant="text" @click="$emit('remove', item.id)">削除</v-btn>
                    <v-btn min-width="44" min-height="44" color="primary" @click="$emit('save', item)">保存</v-btn>
                </div>
            </v-card-text>
        </v-card>
    </div>
</template>

<script lang="ts">
import { Component, Prop, Vue, Emit, toNative } from 'vue-facing-decorator';
import { BUILTIN_STREAM_PRESETS } from '@/util/BuiltinStreamPresets';
import { cloneBuiltinPreset } from '@/util/CustomStreamPresetUtil';

export interface CustomPresetForm {
    id: string; name: string; useFor: 'live' | 'recorded' | 'both'; container: 'm2ts' | 'm2tsll' | 'mp4' | 'webm' | 'hls';
    resolution: string; codec: string; bitDepth: string | number; frameRate: string; hdrMode: string; videoCorrection: string; encoder: string; quality: string;
    deinterlace: string; rawCommand: string; options: Record<string, any>;
}

@Component
class CustomStreamPresetEditor extends Vue {
    @Prop({ default: () => [] }) public items!: CustomPresetForm[];
    selectedBuiltin = 'auto';
    public readonly builtinItems = BUILTIN_STREAM_PRESETS.map(x => ({ title: x.name, value: x.id }));
    public readonly useForItems = [{ title: 'ライブ', value: 'live' }, { title: '録画再生', value: 'recorded' }, { title: '両方', value: 'both' }];
    public readonly containerItems = [{ title: 'M2TS', value: 'm2ts' }, { title: 'M2TS-LL', value: 'm2tsll' }, { title: 'MP4', value: 'mp4' }, { title: 'WebM', value: 'webm' }, { title: 'HLS', value: 'hls' }];
    public readonly resolutionItems = ['source', '2160p', '1080p', '720p', '480p', '240p'];
    public readonly codecItems = [{ title: 'コピー', value: 'copy' }, { title: 'H.264', value: 'h264' }, { title: 'HEVC', value: 'hevc' }];
    public readonly bitDepthItems = [{ title: 'source', value: 'source' }, 8, 10];
    public readonly frameRateItems = ['source', '30p', '60p'];
    public readonly hdrItems = [{ title: '維持', value: 'preserve' }, { title: 'トーンマップ', value: 'tone-map' }, { title: 'SDR', value: 'sdr' }];
    public readonly correctionItems = [{ title: '自動', value: 'auto' }, { title: 'オフ', value: 'off' }, { title: '明るめ', value: 'bright' }];
    public readonly qualityItems = ['original', 'highest', 'high', 'balanced', 'compact'];
    public readonly deinterlaceItems = ['auto', 'off', '30p', '60p'];

    @Emit('save') emitSave(item: CustomPresetForm): CustomPresetForm { return item; }

    cloneBuiltin(): void {
        const preset = BUILTIN_STREAM_PRESETS.find(x => x.id === this.selectedBuiltin) ?? BUILTIN_STREAM_PRESETS[0];
        const base: any = cloneBuiltinPreset(preset, `custom-${Date.now()}`);
        this.items.push({ id: base.id, name: base.name, useFor: base.useFor, container: base.container, resolution: base.output.resolution ?? 'source', codec: base.output.codec ?? 'h264', bitDepth: base.output.bitDepth ?? 'source', frameRate: base.output.frameRate ?? 'source', hdrMode: base.output.hdrMode ?? 'sdr', videoCorrection: base.output.videoCorrection ?? 'auto', encoder: '', quality: base.quality, deinterlace: base.output.deinterlace ?? 'auto', rawCommand: '', options: { ...(base.customOptions ?? {}) } });
    }
    newPreset(): void { this.items.push({ id: `custom-${Date.now()}`, name: 'カスタムプリセット', useFor: 'both', container: 'hls', resolution: '1080p', codec: 'h264', bitDepth: 8, frameRate: 'source', hdrMode: 'sdr', videoCorrection: 'auto', encoder: '', quality: 'balanced', deinterlace: 'auto', rawCommand: '', options: {} }); }
}
export default toNative(CustomStreamPresetEditor);
</script>

<style scoped>
.v-list-item-title, .v-card-title { white-space: normal; }
</style>
