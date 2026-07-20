<template>
    <v-main>
        <TitleBar title="視聴"></TitleBar>
        <transition name="page">
            <div class="video-container-wrap mx-auto">
                <VideoContainer v-if="videoParam !== null" v-bind:videoParam="videoParam"></VideoContainer>
                <WatchOnRecordedInfoCard v-if="recordedId !== null" v-bind:recordedId="recordedId"></WatchOnRecordedInfoCard>
                <div style="visibility: hidden">dummy</div>
            </div>
        </transition>
    </v-main>
</template>

<script lang="ts">
import WatchOnRecordedInfoCard from '@/components/recorded/watch/WatchRecordedInfoCard.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import VideoContainer from '@/components/video/VideoContainer.vue';
import { BaseVideoParam, NormalVideoParam } from '@/components/video/ViedoParam';
import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import IChannelModel from '@/model/channels/IChannelModel';
import container from '@/model/ModelContainer';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import JikkyoUtil from '@/util/JikkyoUtil';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';
import * as apid from '../../../api';


@Component({
    components: {
        TitleBar,
        VideoContainer,
        WatchOnRecordedInfoCard,
    },
})
class WatchRecorded extends Vue {
    public videoParam: BaseVideoParam | null = null;
    public recordedId: apid.RecordedId | null = null;

    private recordedApiModel: IRecordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    private channelModel: IChannelModel = container.get<IChannelModel>('IChannelModel');
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        // 視聴パラメータセット
        const videoId = typeof this.$route.query.videoId !== 'string' ? null : parseInt(this.$route.query.videoId, 10);
        this.recordedId = typeof this.$route.query.recordedId !== 'string' ? null : parseInt(this.$route.query.recordedId, 10);

        this.$nextTick(async () => {
            const jikkyoKakologParam = this.recordedId === null ? null : await this.getJikkyoKakologParam(this.recordedId);
            if (videoId !== null) {
                (this.videoParam as NormalVideoParam) = {
                    type: 'Normal',
                    src: `./api/videos/${videoId}`,
                    ...(jikkyoKakologParam ?? {}),
                };
            }

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }

    /**
     * 録画情報からニコニコ実況過去ログの取得パラメータを解決する
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

export default toNative(WatchRecorded);
</script>

<style lang="sass" scoped>
.video-container-wrap
    max-width: 1200px
</style>
