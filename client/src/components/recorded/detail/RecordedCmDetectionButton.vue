<template>
    <v-menu v-if="enabled && candidates.length > 0" location="bottom start">
        <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-dots-vertical" size="small" variant="text" aria-label="CM detection"></v-btn></template>
        <v-card class="menu-card" width="320">
            <v-list class="menu-card-body" density="compact">
                <v-list-item v-for="video in candidates" :key="video.id" @click="detect(video.id)">
                    <v-list-item-title>試験的 CM 検出</v-list-item-title>
                    <v-list-item-subtitle>無音のみで判定、精度に限界あり · {{ video.name }}</v-list-item-subtitle>
                </v-list-item>
            </v-list>
        </v-card>
    </v-menu>
</template>
<script lang="ts">
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../../api';
import container from '@/model/ModelContainer';
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
@Component
class RecordedCmDetectionButton extends Vue {
    @Prop({ required: true }) public videoFiles!: apid.VideoFile[];
    private chapterlessIds: apid.VideoFileId[] = [];
    private videoApi = container.get<IVideoApiModel>('IVideoApiModel');
    private config = container.get<IServerConfigModel>('IServerConfigModel');
    private snackbar = container.get<ISnackbarState>('ISnackbarState');
    get candidates(): apid.VideoFile[] {
        return this.videoFiles.filter(v => v.type === 'ts' && this.chapterlessIds.includes(v.id));
    }
    get enabled(): boolean {
        return this.config.getConfig()?.cmDetection?.enabled === true;
    }
    @Watch('videoFiles', { deep: true, immediate: true })
    public async updateCandidates(): Promise<void> {
        const tsFiles = (this.videoFiles ?? []).filter(video => video.type === 'ts');
        const checks = await Promise.all(
            tsFiles.map(async video => {
                try {
                    return (await this.videoApi.getChapters(video.id)).length === 0 ? video.id : null;
                } catch (_err) {
                    return null;
                }
            }),
        );
        this.chapterlessIds = checks.filter((id): id is apid.VideoFileId => id !== null);
    }
    public async detect(id: apid.VideoFileId): Promise<void> {
        try {
            await this.videoApi.detectCm(id);
            this.snackbar.open({ text: 'CM 検出をキューへ登録しました', color: 'success' });
        } catch (_err) {
            this.snackbar.open({ text: 'CM 検出を登録できませんでした', color: 'error' });
        }
    }
}
export default toNative(RecordedCmDetectionButton);
</script>
