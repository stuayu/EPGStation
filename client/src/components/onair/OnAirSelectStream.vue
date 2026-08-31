<template>
    <div class="on-ari-select-stream">
        <v-dialog v-if="isRemove === false" v-model="dialogState.isOpen" max-width="400" scrollable>
            <v-card v-if="channelItem !== null">
                <div class="pa-4 pb-0">
                    <div>{{ channelItem.name }}</div>
                    <v-btn block variant="outlined" min-height="44" class="my-2" @click="openQualitySheet">画質: {{ selectedQualityLabel }}</v-btn>
                    <!-- 狭い端末では 2 つ並べると選択値 (M2TS-LL など) が読めない幅まで縮むため、入りきらなければ折り返す -->
                    <div class="d-flex ga-2 flex-wrap">
                        <v-select
                            v-if="isHiddenStreamTypes === false"
                            :items="dialogState.streamTypes"
                            v-model="dialogState.selectedStreamType"
                            v-on:update:model-value="updateStreamConfig"
                            style="flex: 1 1 140px; max-width: 160px"
                        ></v-select>
                        <v-select
                            v-if="isHiddenStreamConfig === false"
                            :items="dialogState.streamConfigItems"
                            v-model="dialogState.selectedStreamConfig"
                            style="flex: 1 1 140px"
                        ></v-select>
                    </div>
                    <div class="d-flex">
                        <v-switch v-model="dialogState.useURLScheme" v-on:update:model-value="updateAllStreamConfig"></v-switch>
                        <v-list-item-title class="text-subtitle-1">外部アプリで開く</v-list-item-title>
                    </div>
                </div>
                <v-card-actions>
                    <v-btn v-if="!!needsGotoGuideButton === true" color="primary" variant="text" v-on:click="gotoGuide">週間番組表</v-btn>
                    <v-spacer></v-spacer>
                    <v-btn color="primary" variant="text" v-on:click="dialogState.isOpen = false">キャンセル</v-btn>
                    <v-btn color="primary" variant="text" v-on:click="view">視聴</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
        <PlaybackQualitySheet
            v-if="qualitySheetOpen"
            v-model="qualitySheetOpen"
            title="再生画質"
            :profiles="qualityProfiles"
            :selected-id="playbackState.selectedPresetId"
            @select="selectQuality"
            @confirm="confirmQualitySelection"
        ></PlaybackQualitySheet>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';
import StreamSupportUtil from '@/util/StreamSupportUtil';
import IOnAirSelectStreamState from '../../model/state/onair/IOnAirSelectStreamState';
import GuideRouteUtil from '../../util/GuideRouteUtil';
import Util from '../../util/Util';
import * as apid from '../../../../api';
import PlaybackQualitySheet from '@/components/video/quality/PlaybackQualitySheet.vue';
import IPlaybackOptionsState from '@/model/state/video/IPlaybackOptionsState';

@Component({ components: { PlaybackQualitySheet } })
class OnAirSelectStream extends Vue {
    @Prop({ required: false })
    public needsGotoGuideButton: boolean | undefined;

    public dialogState: IOnAirSelectStreamState = container.get<IOnAirSelectStreamState>('IOnAirSelectStreamState');


    get channelItem(): ReturnType<IOnAirSelectStreamState['getChannelItem']> {
        return this.dialogState.getChannelItem();
    }
    public isRemove: boolean = false;
    // ストリーム設定セレクタ再描画用
    public isHiddenStreamTypes: boolean = false;
    public isHiddenStreamConfig: boolean = false;

    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    public playbackState: IPlaybackOptionsState = container.get<IPlaybackOptionsState>('IPlaybackOptionsState');
    public qualitySheetOpen = false;
    get qualityProfiles(): apid.PlaybackProfile[] { return this.playbackState.options?.profiles.filter(profile => profile.available === true) ?? []; }
    get selectedQualityLabel(): string { return this.qualityProfiles.find(profile => profile.id === this.playbackState.selectedPresetId)?.label ?? '自動・おすすめ'; }

    public async openQualitySheet(): Promise<void> {
        const channel = this.dialogState.getChannelItem();
        if (channel === null) return;
        await this.playbackState.loadLive(channel.id).catch(err => console.error(err));
        this.qualitySheetOpen = this.qualityProfiles.length > 0;
    }

    private async maybeOpenQualitySheet(): Promise<void> {
        const saved = localStorage.getItem('epgstation.playback.selection-made') === '1';
        await this.openQualitySheet();
        const preferred = this.playbackState.preference.preferredQuality;
        if (this.qualityProfiles.length > 0 && (saved === false || this.playbackState.preference.autoPlayWithRecommendedQuality === false || !this.qualityProfiles.some(profile => profile.id === preferred))) this.qualitySheetOpen = true;
    }

    public confirmQualitySelection(): void {
        localStorage.setItem('epgstation.playback.selection-made', '1');
        this.qualitySheetOpen = false;
    }

    public selectQuality(id: string): void {
        this.playbackState.selectPreset(id);
        const index = this.qualityProfiles.findIndex(profile => profile.id === id);
        if (index >= 0 && index < this.dialogState.streamConfigItems.length) this.dialogState.selectedStreamConfig = index;
    }

    public beforeUnmount(): void {
        this.dialogState.close();
    }

    public updateAllStreamConfig(): void {
        this.dialogState.updateStreamTypes();
        this.dialogState.updateStreamConfig();

        // ストリーム設定セレクタ再描画
        this.isHiddenStreamTypes = true;
        this.isHiddenStreamConfig = true;
        this.$nextTick(() => {
            this.isHiddenStreamTypes = false;
            this.isHiddenStreamConfig = false;
        });
    }

    public updateStreamConfig(): void {
        this.dialogState.updateStreamConfig();

        // ストリーム設定セレクタ再描画
        this.isHiddenStreamConfig = true;
        this.$nextTick(() => {
            this.isHiddenStreamConfig = false;
        });
    }

    /**
     * 単局表示
     */
    public async gotoGuide(): Promise<void> {
        const channel = this.dialogState.getChannelItem();
        if (channel === null) {
            return;
        }

        // 単局表示 (8 日分の週間番組表)。表示中の時刻・地域などの条件は引き継ぐ
        const query = GuideRouteUtil.createQuery(this.$route, { channelId: channel.id, keepTime: true });

        this.dialogState.isOpen = false;
        await Util.sleep(300);
        await Util.move(this.$router, {
            path: '/guide',
            query: query,
        });
    }

    /**
     * 視聴する
     */
    public async view(): Promise<void> {
        if (this.dialogState.selectedStreamType === 'M2TS') {
            // URL Scheme による再生
            this.m2tsViewOnURLScheme();
        } else if (this.dialogState.selectedStreamType === 'M2TS-LL') {
            // 再生に対応しているか?
            const m2tsllSupport = StreamSupportUtil.checkM2TSLLSupport();
            if (m2tsllSupport.isSupported === false) {
                this.snackbarState.open({
                    color: 'error',
                    text: m2tsllSupport.reason ?? '再生に対応していません',
                });

                return;
            }

            await this.m2tsLLView().catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: '視聴ページへの移動に失敗',
                });
            });
        } else {
            const channel = this.dialogState.getChannelItem();
            if (channel !== null && typeof this.dialogState.selectedStreamType !== 'undefined' && typeof this.dialogState.selectedStreamConfig !== 'undefined') {
                this.dialogState.isOpen = false;
                await Util.sleep(200);
                await Util.move(this.$router, {
                    path: '/onair/watch',
                    query: {
                        type: this.dialogState.selectedStreamType.toLowerCase(),
                        channel: channel.id.toString(10),
                        mode: this.dialogState.selectedStreamConfig.toString(10),
                    },
                }).catch(err => {
                    this.snackbarState.open({
                        color: 'error',
                        text: '視聴ページへの移動に失敗',
                    });
                });
            }
        }
    }

    /**
     * URL Scheme による m2ts 形式の再生
     */
    private m2tsViewOnURLScheme(): void {
        const url = this.dialogState.getM2TSURL();

        if (url === null) {
            const playList = this.dialogState.getM2TPlayListURL();
            if (playList === null) {
                this.snackbarState.open({
                    color: 'error',
                    text: '視聴 URL 生成に失敗',
                });
            } else {
                location.href = playList;
            }
        } else {
            location.href = url;
        }
    }

    /**
     * M2TS Low  Latency 形式の再生
     */
    private async m2tsLLView(): Promise<void> {
        const channel = this.dialogState.getChannelItem();
        if (channel !== null && typeof this.dialogState.selectedStreamType !== 'undefined' && typeof this.dialogState.selectedStreamConfig !== 'undefined') {
            this.dialogState.isOpen = false;
            await Util.sleep(200);
            await Util.move(this.$router, {
                path: '/onair/watch',
                query: {
                    type: 'm2tsll',
                    channel: channel.id.toString(10),
                    mode: this.dialogState.selectedStreamConfig.toString(10),
                },
            }).catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: '視聴ページへの移動に失敗',
                });
            });
        }
    }

    /**
     * dialog の表示状態が変更されたときに呼ばれる
     */
    @Watch('dialogState.isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === true && oldState !== true) void this.maybeOpenQualitySheet();
        if (newState === false && oldState === true) {
            // close
            this.$nextTick(async () => {
                await Util.sleep(100);
                this.isRemove = true;
                this.$nextTick(() => {
                    this.isRemove = false;
                    this.dialogState.close();
                });
            });
        }
    }
}

export default toNative(OnAirSelectStream);
</script>
