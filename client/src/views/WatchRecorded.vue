<template>
    <v-main>
        <TitleBar title="視聴"></TitleBar>
        <transition name="page">
            <div class="watch-layout mx-auto">
                <div class="watch-main">
                    <VideoContainer
                        v-if="videoParam !== null"
                        ref="videoContainer"
                        v-bind:videoParam="videoParam"
                        v-on:ended="onVideoEnded"
                        v-on:remainingTime="onVideoRemainingTime"
                    ></VideoContainer>
                    <WatchOnRecordedInfoCard
                        v-if="recordedId !== null"
                        v-bind:recordedId="recordedId"
                        v-bind:videoFileId="videoParam !== null && 'videoFileId' in videoParam ? (videoParam.videoFileId ?? null) : null"
                    ></WatchOnRecordedInfoCard>
                </div>
                <NextUpPanel v-if="recordedId !== null && isEnabledNextUpPanel === true" ref="nextUpPanel" :recordedId="recordedId" :isHalfWidth="false"></NextUpPanel>
            </div>
        </transition>
    </v-main>
</template>

<script lang="ts">
import WatchOnRecordedInfoCard from '@/components/recorded/watch/WatchRecordedInfoCard.vue';
import NextUpPanel from '@/components/recorded/watch/NextUpPanel.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import VideoContainer from '@/components/video/VideoContainer.vue';
import { BaseVideoParam, NormalVideoParam } from '@/components/video/ViedoParam';
import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import IChannelModel from '@/model/channels/IChannelModel';
import container from '@/model/ModelContainer';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import { isFeatureEnabled } from '@/util/FeatureFlags';
import JikkyoUtil from '@/util/JikkyoUtil';
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
class WatchRecorded extends Vue {
    public videoParam: BaseVideoParam | null = null;
    public recordedId: apid.RecordedId | null = null;

    private recordedApiModel: IRecordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    private channelModel: IChannelModel = container.get<IChannelModel>('IChannelModel');
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private serverConfigModel: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');

    /**
     * featureFlags.nextUpPanel が有効か (無効時はパネル自体を表示しない)
     */
    get isEnabledNextUpPanel(): boolean {
        return isFeatureEnabled(this.serverConfigModel.getConfig(), 'nextUpPanel');
    }

    /**
     * VideoContainer からの再生終了通知を Next Up パネルへ中継する
     */
    public onVideoEnded(): void {
        (this.$refs.nextUpPanel as InstanceType<typeof NextUpPanel> | undefined)?.onVideoEnded();
    }

    /**
     * VideoContainer からの残り再生時間通知を Next Up パネルへ中継する (連続再生カウントダウン用)
     */
    public onVideoRemainingTime(remainingSeconds: number): void {
        (this.$refs.nextUpPanel as InstanceType<typeof NextUpPanel> | undefined)?.onVideoRemainingTime(remainingSeconds);
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        // 視聴パラメータセット
        const videoId = typeof this.$route.query.videoId !== 'string' ? null : parseInt(this.$route.query.videoId, 10);
        this.recordedId = typeof this.$route.query.recordedId !== 'string' ? null : parseInt(this.$route.query.recordedId, 10);

        this.$nextTick(async () => {
            const jikkyoKakologParam = this.recordedId === null ? null : await this.getJikkyoKakologParam(this.recordedId, videoId);
            if (videoId !== null) {
                (this.videoParam as NormalVideoParam) = {
                    type: 'Normal',
                    videoFileId: videoId,
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
    private async getJikkyoKakologParam(
        recordedId: apid.RecordedId,
        videoFileId: apid.VideoFileId | null,
    ): Promise<{ jikkyoChannelId: string; jikkyoStartAt: number; jikkyoEndAt: number } | null> {
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

            // 録画ファイルの実測メタデータがあればそちらを優先する (番組時刻とのずれを防ぐ)
            const videoFile =
                videoFileId === null || typeof recorded.videoFiles === 'undefined'
                    ? undefined
                    : recorded.videoFiles.find(file => file.id === videoFileId);

            if (typeof videoFile !== 'undefined' && typeof videoFile.startAt === 'number') {
                const startAt = videoFile.startAt;
                const endAt =
                    typeof videoFile.duration === 'number' && videoFile.duration > 0
                        ? startAt + Math.round(videoFile.duration * 1000)
                        : recorded.endAt;

                return {
                    jikkyoChannelId: jikkyoChannelId,
                    jikkyoStartAt: startAt,
                    jikkyoEndAt: endAt,
                };
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
