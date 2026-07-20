<template>
    <v-main>
        <TitleBar title="視聴"></TitleBar>
        <transition name="page">
            <div class="video-container-wrap mx-auto">
                <VideoContainer v-if="videoParam !== null" v-bind:videoParam="videoParam"></VideoContainer>
                <WatchOnAirInfoCard v-if="watchParam !== null" v-bind:channel="watchParam.channel" v-bind:mode="watchParam.mode"></WatchOnAirInfoCard>
                <div style="visibility: hidden">dummy</div>
            </div>
        </transition>
    </v-main>
</template>

<script lang="ts">
import WatchOnAirInfoCard from '@/components/onair/watch/WatchOnAirInfoCard.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import VideoContainer from '@/components/video/VideoContainer.vue';
import { BaseVideoParam, LiveHLSParam, LiveMpegTsVideoParam, NormalVideoParam } from '@/components/video/ViedoParam';
import container from '@/model/ModelContainer';
import IChannelModel from '@/model/channels/IChannelModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import JikkyoUtil from '@/util/JikkyoUtil';
import Util from '@/util/Util';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';
import * as apid from '../../../api';


interface WatchParam {
    type: string;
    channel: apid.ChannelId;
    mode: number;
}

@Component({
    components: {
        TitleBar,
        VideoContainer,
        WatchOnAirInfoCard,
    },
})
class WatchOnAir extends Vue {
    public videoParam: BaseVideoParam | null = null;

    private channelModel: IChannelModel = container.get<IChannelModel>('IChannelModel');
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    public watchParam: WatchParam | null = null;

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        // 視聴パラメータセット
        this.watchParam =
            typeof this.$route.query.type !== 'string' || typeof this.$route.query.channel !== 'string' || typeof this.$route.query.mode !== 'string'
                ? null
                : {
                      type: this.$route.query.type,
                      channel: parseInt(this.$route.query.channel, 10),
                      mode: parseInt(this.$route.query.mode, 10),
                  };

        this.$nextTick(async () => {
            if (this.watchParam !== null) {
                // ニコニコ実況の実況チャンネル ID (jk1 など) を解決する
                const jikkyoChannelId = await this.findJikkyoChannelId(this.watchParam.channel);

                if (this.watchParam.type === 'hls') {
                    (this.videoParam as LiveHLSParam) = {
                        type: 'LiveHLS',
                        channelId: this.watchParam.channel,
                        mode: this.watchParam.mode,
                        jikkyoChannelId: jikkyoChannelId,
                    };
                } else if (this.watchParam.type === 'm2tsll') {
                    (this.videoParam as LiveMpegTsVideoParam) = {
                        type: 'LiveMpegTs',
                        src: `${window.location.origin}${Util.getSubDirectory()}/api/streams/live/${this.watchParam.channel}/m2tsll?mode=${this.watchParam.mode}`,
                        jikkyoChannelId: jikkyoChannelId,
                    };
                } else {
                    (this.videoParam as NormalVideoParam) = {
                        type: 'Normal',
                        src: `./api/streams/live/${this.watchParam.channel}/${this.watchParam.type}?mode=${this.watchParam.mode}`,
                        jikkyoChannelId: jikkyoChannelId,
                    };
                }
            }

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }

    /**
     * 視聴チャンネルからニコニコ実況の実況チャンネル ID を解決する
     * @param channelId: apid.ChannelId
     * @return Promise<string | undefined> 解決できなかった場合は undefined
     */
    private async findJikkyoChannelId(channelId: apid.ChannelId): Promise<string | undefined> {
        try {
            let channel = this.channelModel.findChannel(channelId, true);
            if (channel === null) {
                await this.channelModel.fetchChannels();
                channel = this.channelModel.findChannel(channelId, true);
            }

            if (channel === null) {
                return undefined;
            }

            const jikkyoChannelId = JikkyoUtil.findJikkyoChannelId(channel);

            return jikkyoChannelId === null ? undefined : jikkyoChannelId;
        } catch (err) {
            console.error(err);

            return undefined;
        }
    }
}

export default toNative(WatchOnAir);
</script>

<style lang="sass" scoped>
.video-container-wrap
    max-width: 1200px
</style>
