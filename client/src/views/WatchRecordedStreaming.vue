<template>
    <v-main>
        <TitleBar title="視聴"></TitleBar>
        <transition name="page">
            <div class="watch-layout mx-auto">
                <div class="watch-main">
                    <VideoContainer v-if="videoParam !== null" v-bind:videoParam="videoParam"></VideoContainer>
                    <WatchOnRecordedInfoCard
                        v-if="videoParam !== null"
                        v-bind:recordedId="videoParam.recordedId"
                        v-bind:videoFileId="videoParam.videoFileId"
                    ></WatchOnRecordedInfoCard>
                </div>
                <NextUpPanel
                    v-if="videoParam !== null && isEnabledNextUpPanel === true"
                    :recordedId="videoParam.recordedId"
                    :isHalfWidth="false"
                    :streamingType="videoParam.type === 'RecordedStreaming' ? videoParam.streamingType : 'hls'"
                    :mode="videoParam.mode"
                ></NextUpPanel>
            </div>
        </transition>
    </v-main>
</template>

<script lang="ts">
import WatchOnRecordedInfoCard from '@/components/recorded/watch/WatchRecordedInfoCard.vue';
import NextUpPanel from '@/components/recorded/watch/NextUpPanel.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import VideoContainer from '@/components/video/VideoContainer.vue';
import * as VideoParam from '@/components/video/ViedoParam';
import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import IChannelModel from '@/model/channels/IChannelModel';
import container from '@/model/ModelContainer';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import { isFeatureEnabled } from '@/util/FeatureFlags';
import { JikkyoKakologParam, resolveJikkyoKakologParam } from '@/util/JikkyoKakologParam';
import Util from '@/util/Util';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';
import * as apid from '../../../api';

@Component({
    components: {
        TitleBar,
        VideoContainer,
        WatchOnRecordedInfoCard,
        NextUpPanel,
    },
})
class WatchRecordedStreaming extends Vue {
    public videoParam: VideoParam.RecordedStreamingParam | VideoParam.RecordedHLSParam | null = null;
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private recordedApiModel: IRecordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    private channelModel: IChannelModel = container.get<IChannelModel>('IChannelModel');
    private videoApiModel: IVideoApiModel = container.get<IVideoApiModel>('IVideoApiModel');
    private serverConfigModel: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');

    /**
     * featureFlags.nextUpPanel が有効か (無効時はパネル自体を表示しない)
     */
    get isEnabledNextUpPanel(): boolean {
        return isFeatureEnabled(this.serverConfigModel.getConfig(), 'nextUpPanel');
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        // 視聴パラメータセット
        const videoFileId = parseInt(Util.getRouteString(this.$route.params.id) ?? '', 10);
        const recordedId = typeof this.$route.query.recordedId !== 'string' ? null : parseInt(this.$route.query.recordedId, 10);
        const streamingType = typeof this.$route.query.streamingType !== 'string' ? null : this.$route.query.streamingType;
        const mode = typeof this.$route.query.mode !== 'string' ? null : parseInt(this.$route.query.mode, 10);

        this.$nextTick(async () => {
            if (videoFileId !== null && recordedId !== null && streamingType !== null && mode !== null) {
                // ニコニコ実況 過去ログ再生用パラメータ取得
                const jikkyoKakologParam = await this.getJikkyoKakologParam(recordedId, videoFileId);

                if (streamingType === 'hls') {
                    this.videoParam = {
                        type: 'RecordedHLS',
                        recordedId: recordedId,
                        videoFileId: videoFileId,
                        mode: mode,
                        ...(jikkyoKakologParam ?? {}),
                    };
                } else {
                    this.videoParam = {
                        type: 'RecordedStreaming',
                        recordedId: recordedId,
                        videoFileId: videoFileId,
                        streamingType: streamingType,
                        mode: mode,
                        ...(jikkyoKakologParam ?? {}),
                    };
                }
            }

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }

    /**
     * ニコニコ実況 過去ログ取得に必要なパラメータを生成する
     * 基準時刻は録画ファイルの先頭に対応する実時刻 (`videoFile.startAt`) を使う
     * @param recordedId: apid.RecordedId
     * @param videoFileId: apid.VideoFileId
     * @return Promise<JikkyoKakologParam | null>
     */
    private async getJikkyoKakologParam(recordedId: apid.RecordedId, videoFileId: apid.VideoFileId): Promise<JikkyoKakologParam | null> {
        return resolveJikkyoKakologParam({
            recordedApiModel: this.recordedApiModel,
            channelModel: this.channelModel,
            videoApiModel: this.videoApiModel,
            recordedId: recordedId,
            videoFileId: videoFileId,
        });
    }
}

export default toNative(WatchRecordedStreaming);
</script>

<style lang="sass" scoped>
.watch-layout
    display: flex
    gap: 16px
    align-items: flex-start
    max-width: 1600px

.watch-main
    flex: 1
    min-width: 0

@media (max-width: 1200px)
    .watch-layout
        flex-direction: column
</style>
