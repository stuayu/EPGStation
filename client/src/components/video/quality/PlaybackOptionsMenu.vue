<template>
    <div class="playback-options-menu">
        <template v-if="isMobile">
            <v-btn icon="mdi-cog" variant="text" aria-label="再生設定" @click="open = true"></v-btn>
            <PlaybackQualitySheet v-model="open" title="再生画質" :profiles="profiles" :selected-id="selectedId" @select="select" @confirm="confirm"></PlaybackQualitySheet>
        </template>
        <v-menu v-else v-model="open" location="bottom end">
            <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-cog" variant="text" aria-label="再生設定"></v-btn></template>
            <v-card class="menu-card" min-width="280">
                <div class="menu-card-body">
                    <div class="text-subtitle-2 px-4 pt-3">画質</div>
                    <PlaybackQualityList :profiles="profiles" :selected-id="selectedId" @select="select"></PlaybackQualityList>
                    <v-divider></v-divider>
                    <v-list-item min-height="44" title="映像補正" :subtitle="correctionLabel" @click="chooseCorrection"></v-list-item>
                    <v-list-item v-if="showHdr" min-height="44" title="HDR" :subtitle="hdrLabel" @click="chooseHdr"></v-list-item>
                </div>
            </v-card>
        </v-menu>
    </div>
</template>

<script lang="ts">
import * as apid from '../../../../../api';
import { Component, Emit, Prop, Vue, toNative } from 'vue-facing-decorator';
import PlaybackQualityList from './PlaybackQualityList.vue';
import PlaybackQualitySheet from './PlaybackQualitySheet.vue';

@Component({ components: { PlaybackQualityList, PlaybackQualitySheet } })
class PlaybackOptionsMenu extends Vue {
    @Prop({ required: true }) public profiles!: apid.PlaybackProfile[];
    @Prop({ default: 'auto' }) public selectedId!: string;
    @Prop({ default: false }) public showHdr!: boolean;
    @Prop({ default: 'auto' }) public correction!: string;
    @Prop({ default: 'auto' }) public hdrMode!: string;
    public open = false;
    get isMobile(): boolean { return this.$vuetify.display.smAndDown; }
    get correctionLabel(): string { return this.correction === 'off' ? 'オフ' : this.correction === 'bright' ? '明るめ' : '自動'; }
    get hdrLabel(): string { return this.hdrMode === 'preserve' ? 'HDR を維持' : this.hdrMode === 'sdr' ? 'SDR に変換' : '自動'; }
    @Emit('select') public select(id: string): string { return id; }
    @Emit('confirm') public confirm(id: string): string { return id; }
    public chooseCorrection(): void { this.emitCorrection(this.correction === 'auto' ? 'off' : 'auto'); }
    public chooseHdr(): void { this.emitHdr(this.hdrMode === 'auto' ? 'preserve' : 'auto'); }
    @Emit('update:correction') public emitCorrection(value: string): string { return value; }
    @Emit('update:hdrMode') public emitHdr(value: string): string { return value; }
}

export default toNative(PlaybackOptionsMenu);
</script>

<style scoped>
.menu-card { max-width: calc(100vw - 32px); }
.menu-card-body { max-height: min(70svh, 480px); overflow-y: auto; }
</style>
