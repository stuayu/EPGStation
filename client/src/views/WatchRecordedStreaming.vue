<template>
    <v-main>
        <TitleBar title="視聴"></TitleBar>
        <transition name="page">
            <div class="video-container-wrap mx-auto">
                <VideoContainer v-if="videoParam !== null" v-bind:videoParam="videoParam"></VideoContainer>
                <WatchOnRecordedInfoCard v-if="videoParam !== null" v-bind:recordedId="videoParam.recordedId"></WatchOnRecordedInfoCard>
                <div style="visibility: hidden">dummy</div>
            </div>
        </transition>
    </v-main>
</template>

<script lang="ts">
import WatchOnRecordedInfoCard from '@/components/recorded/watch/WatchRecordedInfoCard.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import VideoContainer from '@/components/video/VideoContainer.vue';
import * as VideoParam from '@/components/video/ViedoParam';
import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import IChannelModel from '@/model/channels/IChannelModel';
import container from '@/model/ModelContainer';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import JikkyoUtil from '@/util/JikkyoUtil';
import Util from '@/util/Util';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';
import * as apid from '../../../api';

@Component({
    components: {
        TitleBar,
        VideoContainer,
        WatchOnRecordedInfoCard,
    },
})
class WatchRecordedStreaming extends Vue {
    public videoParam: VideoParam.RecordedStreamingParam | VideoParam.RecordedHLSParam | null = null;
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private recordedApiModel: IRecordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    private channelModel: IChannelModel = container.get<IChannelModel>('IChannelModel');

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
                const jikkyoKakologParam = await this.getJikkyoKakologParam(recordedId);

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
     * @param recordedId: apid.RecordedId
     * @return Promise<{ jikkyoChannelId: string; jikkyoStartAt: number; jikkyoEndAt: number } | null>
     */
    private async getJikkyoKakologParam(recordedId: apid.RecordedId): Promise<{ jikkyoChannelId: string; jikkyoStartAt: number; jikkyoEndAt: number } | null> {
        try {
            const recorded = await this.recordedApiModel.get(recordedId, true);
            let channel = this.channelModel.findChannel(recorded.channelId, true);
            if (channel === null) {
                await this.channelModel.fetchChannels();
                channel = this.channelModel.findChannel(recorded.channelId, true);
            }

            const jikkyoChannelId = channel === null ? null : JikkyoUtil.findJikkyoChannelId(channel);
            if (jikkyoChannelId === null) {
                return null;
            }

            return {
                jikkyoChannelId: jikkyoChannelId,
                jikkyoStartAt: recorded.startAt,
                jikkyoEndAt: recorded.endAt,
            };
        } catch (err) {
            console.error(err);

            return null;
        }
    }
}

export default toNative(WatchRecordedStreaming);
</script>

<style lang="sass" scoped>
.video-container-wrap
    max-width: 1200px
</style>
