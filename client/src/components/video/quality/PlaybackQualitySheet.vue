<template>
    <div class="playback-quality-sheet">
        <v-bottom-sheet v-if="isMobile" v-model="open" scrim="rgba(0,0,0,.45)">
            <v-card class="sheet-card">
                <div class="sheet-handle"></div>
                <v-card-title class="flex-shrink-0">{{ title }}</v-card-title>
                <div class="menu-card-body">
                    <PlaybackQualityList :profiles="profiles" :selected-id="selectedId" :show-detail="showDetail" @select="select"></PlaybackQualityList>
                </div>
                <v-card-actions class="flex-shrink-0"><v-spacer></v-spacer><v-btn color="primary" min-width="96" min-height="44" @click="confirm">再生</v-btn></v-card-actions>
            </v-card>
        </v-bottom-sheet>
        <v-dialog v-else v-model="open" max-width="440" scrollable>
            <v-card>
                <v-card-title>{{ title }}</v-card-title>
                <div class="menu-card-body"><PlaybackQualityList :profiles="profiles" :selected-id="selectedId" :show-detail="showDetail" @select="select"></PlaybackQualityList></div>
                <v-card-actions><v-btn variant="text" min-height="44" @click="cancel">キャンセル</v-btn><v-spacer></v-spacer><v-btn color="primary" min-height="44" @click="confirm">再生</v-btn></v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts">
import * as apid from '../../../../../api';
import { Component, Emit, Prop, Vue, toNative } from 'vue-facing-decorator';
import PlaybackQualityList from './PlaybackQualityList.vue';

@Component({ components: { PlaybackQualityList } })
class PlaybackQualitySheet extends Vue {
    @Prop({ required: true }) public modelValue!: boolean;
    @Prop({ required: true }) public profiles!: apid.PlaybackProfile[];
    @Prop({ default: 'auto' }) public selectedId!: string;
    @Prop({ default: '再生画質' }) public title!: string;
    @Prop({ default: false }) public showDetail!: boolean;

    get open(): boolean { return this.modelValue; }
    set open(value: boolean) { this.emitModelValue(value); }
    get isMobile(): boolean { return this.$vuetify.display.smAndDown; }

    @Emit('update:modelValue')
    public emitModelValue(value: boolean): boolean { return value; }

    @Emit('select')
    public select(id: string): string { return id; }

    @Emit('confirm')
    public confirm(): string { return this.selectedId; }

    @Emit('cancel')
    public cancel(): boolean { return false; }
}

export default toNative(PlaybackQualitySheet);
</script>

<style scoped>
.sheet-card { max-width: calc(100vw - 0px); max-height: min(70svh, 480px); padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right); padding-bottom: calc(16px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; }
.sheet-handle { width: 36px; height: 4px; border-radius: 2px; background: currentColor; opacity: .45; margin: 8px auto 0; flex: 0 0 auto; }
.menu-card-body { min-height: 0; overflow-y: auto; flex: 1 1 auto; }
</style>
