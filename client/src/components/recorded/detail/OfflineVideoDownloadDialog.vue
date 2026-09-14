<template>
    <div>
        <v-btn class="ma-1" color="primary" variant="outlined" :disabled="videoFiles.length === 0" @click="open">
            <v-icon start>mdi-download</v-icon>オフライン保存
        </v-btn>
        <v-dialog v-model="isOpen" :fullscreen="isMobile" max-width="520" scrollable>
            <v-card v-if="isOpen">
                <v-card-title>オフライン保存</v-card-title>
                <v-card-text class="menu-card-body">
                    <v-select v-model="selectedVideoId" :items="videoItems" label="保存するファイル"></v-select>
                    <v-radio-group v-model="selectedProfile" :disabled="isLoading">
                        <v-radio v-for="profile in profiles" :key="profile.id" :label="getLabel(profile)" :value="profile.id"></v-radio>
                    </v-radio-group>
                    <v-alert v-if="selectedProfile === 'original-mpeg2'" type="info" variant="tonal" density="compact">
                        元の TS をそのまま保存します。端末で変換して再生します。対応ブラウザでのみ再生できます。
                        <div v-if="selectedVideo !== null" class="mt-1">保存サイズ: {{ formatBytes(selectedVideo.size) }}</div>
                    </v-alert>
                    <v-progress-linear v-if="isLoading" indeterminate></v-progress-linear>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="isOpen = false">キャンセル</v-btn>
                    <v-btn color="primary" :disabled="selectedProfile === null || selectedVideoId === null || isLoading" @click="start">保存開始</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts">
import * as apid from '../../../../../api';
import container from '@/model/ModelContainer';
import IPlaybackOptionsState from '@/model/state/video/IPlaybackOptionsState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import OfflineVideos from '@/services/OfflineVideos';
import { getPlaybackShortLabel } from '@/util/PlaybackLabelUtil';
import StreamSupportUtil from '@/util/StreamSupportUtil';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';

@Component({})
class OfflineVideoDownloadDialog extends Vue {
    @Prop({ required: true })
    public recordedItem!: apid.RecordedItem;
    @Prop({ default: () => [] })
    public videoFiles!: apid.VideoFile[];
    @Prop({ default: undefined })
    public channelName!: string | undefined;
    @Prop({ default: undefined })
    public displayName!: string | undefined;
    public isOpen = false;
    public isLoading = false;
    public selectedVideoId: number | null = null;
    public selectedProfile: string | null = null;
    public playbackState: IPlaybackOptionsState = container.get<IPlaybackOptionsState>('IPlaybackOptionsState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    get isMobile(): boolean { return this.$vuetify.display.smAndDown; }
    get videoItems(): Array<{ title: string; value: number }> { return this.videoFiles.map(video => ({ title: video.name, value: video.id })); }
    get selectedVideo(): apid.VideoFile | null { return this.videoFiles.find(video => video.id === this.selectedVideoId) ?? null; }
    get profiles(): apid.PlaybackProfile[] {
        return (this.playbackState.options?.profiles ?? []).filter(profile => {
            if (profile.role === 'original-mpeg2' || profile.id === 'original-mpeg2') return StreamSupportUtil.isMpeg2ToH264Supported();
            return typeof profile.modes.hls === 'number';
        });
    }
    public async open(): Promise<void> {
        const video = this.videoFiles[0];
        if (video === undefined) return;
        this.isOpen = true;
        if (this.selectedVideoId === video.id) {
            await this.loadProfiles(video.id);
        } else {
            // 変更は onChangeSelectedVideoId() が拾って画質一覧を取り直す
            this.selectedVideoId = video.id;
        }
    }

    /**
     * 保存するファイルを変えたら、そのファイルの画質一覧を取り直す。
     * 録画に TS と tsreplace の HEVC が並ぶ場合、先頭ファイルの一覧のままだと HEVC の「オリジナル (HEVC・無変換)」が出ず、
     * 別ファイル用の画質で保存してしまう
     * @param videoId: number | null
     */
    @Watch('selectedVideoId')
    public async onChangeSelectedVideoId(videoId: number | null): Promise<void> {
        if (videoId === null || this.isOpen === false) return;
        await this.loadProfiles(videoId);
    }

    private async loadProfiles(videoId: number): Promise<void> {
        this.selectedProfile = null;
        this.isLoading = true;
        try {
            // HLS の mode を持たない MPEG-2 Original も含めるため方式を絞らない。
            await this.playbackState.loadRecorded(videoId);
            if (this.selectedVideoId !== videoId) return;
            this.selectedProfile = this.profiles[0]?.id ?? null;
        } catch (err) {
            this.snackbarState.open({ color: 'error', text: '保存画質の取得に失敗しました' });
            console.error(err);
        } finally {
            this.isLoading = false;
        }
    }
    public getLabel(profile: apid.PlaybackProfile): string { return getPlaybackShortLabel(profile, this.playbackState.options?.recommended); }
    public formatBytes(bytes: number): string {
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
        return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
    }
    public async start(): Promise<void> {
        const video = this.videoFiles.find(item => item.id === this.selectedVideoId);
        if (video === undefined || this.selectedProfile === null) return;
        this.isLoading = true;
        try {
            const selected = this.profiles.find(profile => profile.id === this.selectedProfile);
            await OfflineVideos.start(this.recordedItem, video.id, this.selectedProfile, selected?.videoBitrate, {
                channelName: this.channelName,
                displayName: this.displayName,
            });
            this.isOpen = false;
            this.snackbarState.open({ color: 'success', text: 'オフライン保存が完了しました' });
        } catch (err) {
            this.snackbarState.open({ color: 'error', text: err instanceof Error ? err.message : 'オフライン保存に失敗しました' });
            console.error(err);
        } finally { this.isLoading = false; }
    }
}
export default toNative(OfflineVideoDownloadDialog);
</script>
