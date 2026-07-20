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
import container from '@/model/ModelContainer';
import IScrollPositionState from '@/model/state/IScrollPositionState';
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

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        // 視聴パラメータセット
        const videoFileId = parseInt(Util.getRouteString(this.$route.params.id) ?? '', 10);
        const recordedId = typeof this.$route.query.recordedId !== 'string' ? null : parseInt(this.$route.query.recordedId, 10);
        const streamingType = typeof this.$route.query.streamingType !== 'string' ? null : this.$route.query.streamingType;
        const mode = typeof this.$route.query.mode !== 'string' ? null : parseInt(this.$route.query.mode, 10);

        this.$nextTick(async () => {
            if (videoFileId !== null && recordedId !== null && streamingType !== null && mode !== null) {
                if (streamingType === 'hls') {
                    this.videoParam = {
                        type: 'RecordedHLS',
                        recordedId: recordedId,
                        videoFileId: videoFileId,
                        mode: mode,
                    };
                } else {
                    this.videoParam = {
                        type: 'RecordedStreaming',
                        recordedId: recordedId,
                        videoFileId: videoFileId,
                        streamingType: streamingType,
                        mode: mode,
                    };
                }
            }

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }
}

export default toNative(WatchRecordedStreaming);
</script>

<style lang="sass" scoped>
.video-container-wrap
    max-width: 1200px
</style>
