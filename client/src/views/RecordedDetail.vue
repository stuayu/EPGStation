<template>
    <v-content>
        <TitleBar title="録画詳細">
            <template v-slot:menu>
                <RecordedDetailMoreButton
                    v-if="recordedDetailState.getRecorded() !== null"
                    :recordedItem="recordedDetailState.getRecorded().recordedItem"
                    v-on:download="downloadVideo"
                    v-on:downloadPlayList="downloadPlayList"
                ></RecordedDetailMoreButton>
            </template>
        </TitleBar>
        <v-container>
            <transition name="page">
                <div v-if="recordedDetailState.getRecorded() !== null" ref="appContent" class="app-content mx-auto">
                    <div class="content-0 mx-auto">
                        <div class="thumbnail">
                            <v-img
                                aspect-ratio="1.7778"
                                width="100%"
                                max-height="400"
                                :src="recordedDetailState.getRecorded().display.topThumbnailPath"
                                v-on:error="this.src = './img/noimg.png'"
                                :eager="true"
                            ></v-img>
                        </div>
                        <div class="content-description">
                            <div class="title font-weight-bold">
                                {{ recordedDetailState.getRecorded().display.name }}
                            </div>
                            <div class="subtitle-1 mt-2 font-weight-light">
                                {{ recordedDetailState.getRecorded().display.channelName }}
                            </div>
                            <div class="subtitle-2 font-weight-light">
                                {{ recordedDetailState.getRecorded().display.genre }}
                            </div>
                            <div class="subtitle-2 my-2 font-weight-light">
                                {{ recordedDetailState.getRecorded().display.time }} ({{
                                    recordedDetailState.getRecorded().display.duration
                                }}
                                m)
                            </div>
                            <div class="button-wrap d-flex flex-wrap">
                                <div class="d-flex flex-wrap">
                                    <RecordedDetailPlayButton
                                        v-if="
                                            typeof recordedDetailState.getRecorded().display.videoFiles !== 'undefined'
                                        "
                                        :videoFiles="recordedDetailState.getRecorded().display.videoFiles"
                                        v-on:play="play"
                                    ></RecordedDetailPlayButton>
                                    <v-btn color="primary" class="ma-1">
                                        <v-icon left dark>mdi-play-circle</v-icon>
                                        streaming
                                    </v-btn>
                                </div>
                                <div class="d-flex flex-wrap">
                                    <RecordedDetailEncodeButton
                                        :recordedItem="recordedDetailState.getRecorded().recordedItem"
                                        :videoFiles="recordedDetailState.getRecorded().display.videoFiles"
                                    ></RecordedDetailEncodeButton>
                                    <RecordedDetailStopEncodeButton
                                        :recordedItem="recordedDetailState.getRecorded().recordedItem"
                                        v-on:stopEncode="stopEncode"
                                    ></RecordedDetailStopEncodeButton>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="content-1 mt-6">
                        <div class="body-2 description">
                            {{ recordedDetailState.getRecorded().display.description }}
                        </div>
                        <div v-if="isHideExtend === false" ref="extend" class="mt-2 body-2 extended">
                            {{ recordedDetailState.getRecorded().display.extended }}
                        </div>
                    </div>
                    <Snackbar></Snackbar>
                </div>
            </transition>
        </v-container>
    </v-content>
</template>

<script lang="ts">
import RecordedDetailEncodeButton from '@/components/recorded/detail/RecordedDetailEncodeButton.vue';
import RecordedDetailMoreButton from '@/components/recorded/detail/RecordedDetailMoreButton.vue';
import RecordedDetailPlayButton from '@/components/recorded/detail/RecordedDetailPlayButton.vue';
import RecordedDetailStopEncodeButton from '@/components/recorded/detail/RecordedDetailStopEncodeButton.vue';
import Snackbar from '@/components/snackbar/Snackbar.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import ISettingStorageModel, { ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import Util from '@/util/Util';
import { Component, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../api';
import IRecordedDetailState from '../model/state/recorded/detail/IRecordedDetailState';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

@Component({
    components: {
        TitleBar,
        Snackbar,
        RecordedDetailPlayButton,
        RecordedDetailEncodeButton,
        RecordedDetailStopEncodeButton,
        RecordedDetailMoreButton,
    },
})
export default class RecordedDetail extends Vue {
    public isHideExtend = false;

    public recordedDetailState: IRecordedDetailState = container.get<IRecordedDetailState>('IRecordedDetailState');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private settingValue: ISettingValue | null = null;
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async () => {
        await this.fetchData();
    }).bind(this);

    public created(): void {
        this.settingValue = this.setting.getSavedValue();

        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    public beforeDestroy(): void {
        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);
    }

    public play(video: apid.VideoFile): void {
        const url = this.recordedDetailState.getVideoURL(video);

        location.href = url !== null ? url : this.recordedDetailState.getVideoPlayListURL(video);
    }

    public downloadVideo(video: apid.VideoFile): void {
        const url = this.recordedDetailState.getVideoDownloadURL(video);

        location.href = url !== null ? url : this.recordedDetailState.getVideoDownloadRawURL(video);
    }

    public downloadPlayList(video: apid.VideoFile): void {
        location.href = this.recordedDetailState.getVideoPlayListURL(video);
    }

    public async stopEncode(): Promise<void> {
        try {
            await this.recordedDetailState.stopEncode();
            this.snackbarState.open({
                color: 'success',
                text: 'エンコード停止',
            });
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: 'エンコード停止に失敗',
            });
        }
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.recordedDetailState.clearData();
        this.$nextTick(async () => {
            await this.fetchData().catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: '録画データ取得に失敗',
                });
                console.error(err);
            });

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }

    /**
     * データ取得
     */
    private async fetchData(): Promise<void> {
        await this.recordedDetailState.fetchData(
            parseInt(this.$route.params.id, 10),
            this.settingValue === null ? true : this.settingValue.isRecordedHalfWidthDisplayed,
        );

        // 番組詳細 URL 処理
        this.$nextTick(() => {
            this.isHideExtend = true;
            this.$nextTick(() => {
                this.isHideExtend = false;
                this.$nextTick(() => {
                    if (typeof this.$refs.extend !== 'undefined') {
                        let str = (<Element>this.$refs.extend).innerHTML;
                        str = str.replace(/(http:\/\/[\x21-\x7e]+)/gi, "<a href='$1' target='_blank'>$1</a>");
                        str = str.replace(/(https:\/\/[\x21-\x7e]+)/gi, "<a href='$1' target='_blank'>$1</a>");
                        (<Element>this.$refs.extend).innerHTML = str;
                    }
                });
            });
        });
    }
}
</script>

<style lang="sass" scoped>
$switch-display-width: 800px

.app-content
    width: 100%

.thumbnail
    margin-top: auto
    margin-bottom: auto
    min-width: 100px
    max-height: 240px
    overflow: hidden


.content-description
    margin-top: 8px

.description, .extended
    white-space: pre-wrap

@media screen and (min-width: $switch-display-width)
    .content-0
        display: flex

    .thumbnail
        min-width: 400px
        width: 400px
        max-height: auto

    .content-description
        margin-top: auto
        margin-bottom: auto
        margin-left: 6px
</style>