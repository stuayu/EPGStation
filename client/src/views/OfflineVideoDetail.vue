<template>
    <v-main>
        <TitleBar title="オフライン番組情報"></TitleBar>
        <v-container>
            <v-alert v-if="video === null && isLoaded === true" type="error" variant="tonal">保存済み動画が見つかりません。</v-alert>
            <div v-else-if="video !== null" class="offline-detail app-content mx-auto">
                <div class="detail-layout">
                    <div class="detail-main">
                        <div class="content-0 mx-auto">
                            <v-img v-if="video.thumbnailURLs?.[0]" :src="video.thumbnailURLs[0]" class="thumbnail" aspect-ratio="1.7778" cover></v-img>
                            <div class="content-description">
                                <div class="title font-weight-bold">{{ info.name }}</div>
                                <div class="text-subtitle-1 my-1 d-flex align-center channel-line">
                                    <img v-if="video.channelLogoURL" :src="video.channelLogoURL" class="channel-logo mr-2" alt="" />
                                    <span>{{ info.channelName }}</span>
                                </div>
                                <div class="text-subtitle-2 font-weight-light">{{ info.time }}</div>
                                <div class="text-caption text-medium-emphasis mt-1">保存画質: {{ video.profileLabel ?? video.profile }} / サイズ: {{ formatBytes(video.sizeBytes) }}</div>
                                <div class="button-wrap mt-3 d-flex flex-wrap">
                                    <v-btn color="primary" class="ma-1" @click="play">再生</v-btn>
                                    <v-btn v-if="isOnline && recordedId !== null" variant="outlined" class="ma-1" @click="openRecordedDetail">録画詳細を開く</v-btn>
                                    <v-btn color="error" variant="text" class="ma-1" @click="deleteDialog = true">削除</v-btn>
                                </div>
                            </div>
                        </div>
                        <WatchPanelProgram :info="info" :showHeading="false"></WatchPanelProgram>
                    </div>
                </div>
            </div>
        </v-container>
        <v-dialog v-model="deleteDialog" max-width="420">
            <v-card>
                <v-card-title>オフライン保存を削除</v-card-title>
                <v-card-text>この保存データを削除しますか？</v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="deleteDialog = false">キャンセル</v-btn>
                    <v-btn color="error" @click="remove">削除</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </v-main>
</template>

<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import WatchPanelProgram from '@/components/watch/WatchPanelProgram.vue';
import OfflineVideos from '@/services/OfflineVideos';
import { OfflineVideoRecord } from '@/services/OfflineVideoStorage';
import container from '@/model/ModelContainer';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IOfflineVideoState from '@/model/state/offline/IOfflineVideoState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { createOfflineProgramInfo, getOfflineVideoKey, OfflineProgramInfo } from '../../../src/util/OfflineUxUtil';
import GenreUtil from '@/util/GenreUtil';
import Util from '@/util/Util';
import * as apid from '../../../api';
import { Component, Vue, toNative } from 'vue-facing-decorator';

@Component({ components: { TitleBar, WatchPanelProgram } })
class OfflineVideoDetail extends Vue {
    private offlineState: IOfflineVideoState = container.get<IOfflineVideoState>('IOfflineVideoState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    public video: OfflineVideoRecord | null = null;
    public deleteDialog = false;
    public isLoaded = false;

    get info(): OfflineProgramInfo {
        if (this.video === null) return { channelId: null, name: '録画番組' };
        return (this.video.programInfo as OfflineProgramInfo | undefined) ?? createOfflineProgramInfo(this.video.program, {
            videoFileId: this.video.videoId,
            resolveGenre: (genre, subGenre) => GenreUtil.getGenres(genre, subGenre),
        });
    }
    get isOnline(): boolean { return navigator.onLine !== false; }
    get recordedId(): number | null {
        const id = (this.video?.program as apid.RecordedItem | undefined)?.id;
        return typeof id === 'number' ? id : null;
    }
    get videoKey(): string { return this.video === null ? 'none' : getOfflineVideoKey(this.video); }

    public async mounted(): Promise<void> {
        try {
            await this.offlineState.load().catch(error => console.error('offline detail load error', error));
            const key = typeof this.$route.params.key === 'string' ? this.$route.params.key : '';
            this.video = this.offlineState.find(key);
        } finally {
            this.isLoaded = true;
            await this.scrollState.emitDoneGetData();
        }
        OfflineVideos.eventTarget.addEventListener('change', this.onOfflineVideosChanged);
    }

    public beforeUnmount(): void {
        OfflineVideos.eventTarget.removeEventListener('change', this.onOfflineVideosChanged);
    }

    private onOfflineVideosChanged(): void {
        void this.offlineState.load().then(() => {
            this.video = this.offlineState.find(this.videoKey);
        });
    }

    public formatBytes(bytes: number): string {
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
        return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
    }

    public play(): void {
        if (this.video === null) return;
        void Util.move(this.$router, { path: `/offline-videos/${encodeURIComponent(getOfflineVideoKey(this.video))}/watch`, query: { from: 'detail' } });
    }

    public openRecordedDetail(): void {
        if (this.recordedId !== null) void Util.move(this.$router, { path: `/recorded/detail/${this.recordedId.toString(10)}` });
    }

    public async remove(): Promise<void> {
        if (this.video === null) return;
        this.deleteDialog = false;
        try {
            await this.offlineState.remove(this.video);
            await Util.move(this.$router, { path: '/offline-videos' });
        } catch (error) {
            this.snackbarState.open({ color: 'error', text: 'オフライン保存の削除に失敗しました' });
            console.error(error);
        }
    }
}

export default toNative(OfflineVideoDetail);
</script>

<style lang="sass" scoped>
.offline-detail
    width: 100%

.thumbnail
    width: 100%
    max-width: 560px
    max-height: 315px

.content-description
    margin-top: 8px

.channel-logo
    border-radius: 2px
    flex: 0 0 auto
    width: 36px
    height: 20px
    object-fit: contain

@media screen and (min-width: 800px)
    .content-0
        display: flex

    .thumbnail
        min-width: 400px
        width: 400px
        height: 225px

    .content-description
        margin: auto 0 auto 8px
</style>
