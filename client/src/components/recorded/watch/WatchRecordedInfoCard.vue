<template>
    <div v-if="displayInfo !== null" class="watch-recorded-info-card pa-2">
        <v-card class="mx-auto" max-width="800">
            <v-list-item three-line style="cursor: pointer">
                <div class="v-list-item-content">
                    <div class="text-subtitle-1 font-weight-black">{{ displayInfo.channelName }}</div>
                    <div class="text-caption font-weight-light">{{ displayInfo.time }}</div>
                    <div class="text-subtitle-2">
                        {{ displayInfo.name }}
                    </div>
                    <div class="text-body-2 font-weight-light">{{ displayInfo.description }}</div>
                    <v-btn v-if="videoFileId !== null" class="mt-2" size="small" variant="outlined" v-on:click.stop="toggleWatched">
                        {{ watchHistory?.status === 'watched' ? '未視聴に戻す' : '視聴済みにする' }}
                    </v-btn>
                </div>
            </v-list-item>
        </v-card>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import IWatchRecordedInfoState, { DsiplayWatchInfo } from '@/model/state/recorded/watch/IWatchRecordedInfoState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../../api';

@Component({})
class WatchOnRecordedInfoCard extends Vue {
    @Prop({ required: true })
    public recordedId!: apid.RecordedId;

    @Prop({ default: null })
    public videoFileId!: apid.VideoFileId | null;

    public watchHistory: apid.WatchHistory | null = null;

    public displayInfo: DsiplayWatchInfo | null = null;

    private videoApi = container.get<IVideoApiModel>('IVideoApiModel');
    private infoState: IWatchRecordedInfoState = container.get<IWatchRecordedInfoState>('IWatchRecordedInfoState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async (): Promise<void> => {
        await this.update();
    }).bind(this);

    public created(): void {
        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    public beforeUnmount(): void {
        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.infoState.clear();
        this.displayInfo = null;
        this.$nextTick(async () => {
            await this.update();
        });
    }

    private async update(): Promise<void> {
        await this.infoState.update(this.recordedId).catch(err => {
            this.snackbarState.open({
                color: 'error',
                text: '番組情報取得に失敗',
            });
            console.error(err);
        });

        this.displayInfo = this.infoState.getInfo();
        if (this.videoFileId !== null) this.watchHistory = await this.videoApi.getPlaybackPosition(this.videoFileId);
    }
    public async toggleWatched(): Promise<void> {
        if (this.videoFileId === null) return;
        const duration = this.watchHistory?.duration ?? (await this.videoApi.getDuration(this.videoFileId));
        const position = this.watchHistory?.status === 'watched' ? 0 : duration;
        this.watchHistory = await this.videoApi.savePlaybackPosition(this.videoFileId, { position, duration });
    }
}

export default toNative(WatchOnRecordedInfoCard);
</script>
