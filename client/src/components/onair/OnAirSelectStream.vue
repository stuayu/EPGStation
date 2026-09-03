<template>
    <div class="on-ari-select-stream">
        <v-dialog v-if="isRemove === false" v-model="dialogState.isOpen" max-width="400" scrollable>
            <v-card v-if="channelItem !== null">
                <div class="pa-4 pb-0 select-stream-body">
                    <div>{{ channelItem.name }}</div>
                    <!-- 画質はダイアログの中で開閉する (別のダイアログを重ねるとポップアップが 2 重になるため) -->
                    <v-btn block variant="outlined" min-height="44" class="my-2" :append-icon="isQualityListOpen === true ? 'mdi-chevron-up' : 'mdi-chevron-down'" @click="toggleQualityList">
                        画質: {{ selectedQualityLabel }}
                    </v-btn>
                    <v-expand-transition>
                        <v-sheet v-show="isQualityListOpen === true" class="quality-list mb-2" rounded border>
                            <PlaybackQualityList
                                :profiles="qualityProfiles"
                                :selected-id="playbackState.selectedPresetId"
                                :source="playbackState.options?.source"
                                :recommended="playbackState.options?.recommended"
                                :stream-container="selectedContainer"
                                @select="selectQuality"
                            ></PlaybackQualityList>
                        </v-sheet>
                    </v-expand-transition>
                    <!-- 狭い端末では 2 つ並べると選択値 (M2TS-LL など) が読めない幅まで縮むため、入りきらなければ折り返す -->
                    <div class="d-flex ga-2 flex-wrap">
                        <v-select
                            v-if="isHiddenStreamTypes === false"
                            :items="dialogState.streamTypes"
                            v-model="dialogState.selectedStreamType"
                            v-on:update:model-value="updateStreamConfig"
                            style="flex: 1 1 140px; max-width: 160px"
                            hint="配信方式を変えると選べる画質も変わります"
                            persistent-hint
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
                    <v-btn color="primary" variant="text" min-height="44" v-on:click="dialogState.isOpen = false">キャンセル</v-btn>
                    <v-btn color="primary" variant="text" min-height="44" v-on:click="view">視聴</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';
import StreamSupportUtil from '@/util/StreamSupportUtil';
import IOnAirSelectStreamState, { LiveStreamType } from '../../model/state/onair/IOnAirSelectStreamState';
import GuideRouteUtil from '../../util/GuideRouteUtil';
import Util from '../../util/Util';
import * as apid from '../../../../api';
import PlaybackQualityList from '@/components/video/quality/PlaybackQualityList.vue';
import IPlaybackOptionsState from '@/model/state/video/IPlaybackOptionsState';
import { getPlaybackShortLabel } from '@/util/PlaybackLabelUtil';

// 配信方式ごとの playback-options 上のコンテナ名
const STREAM_TYPE_CONTAINERS: { [key in LiveStreamType]: Exclude<apid.PlaybackContainer, 'normal'> } = {
    'M2TS': 'm2ts',
    'M2TS-LL': 'm2tsll',
    WebM: 'webm',
    MP4: 'mp4',
    HLS: 'hls',
};

@Component({ components: { PlaybackQualityList } })
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
    public isQualityListOpen = false;

    // 読み込みの世代。配信方式を続けて切り替えたとき、古い応答が新しい選択を上書きしないようにする
    private loadGeneration = 0;

    get selectedContainer(): Exclude<apid.PlaybackContainer, 'normal'> | undefined {
        return typeof this.dialogState.selectedStreamType === 'undefined' ? undefined : STREAM_TYPE_CONTAINERS[this.dialogState.selectedStreamType];
    }

    /**
     * 選択できる画質。
     * この配信方式で実際に mode を持つものだけに絞る (プレイヤー内の画質メニューと同じ規則)。
     * mode を持たないプロファイルは選んでも配信設定が変わらず、選択が黙って無視される
     */
    get qualityProfiles(): apid.PlaybackProfile[] {
        const container = this.selectedContainer;

        return (
            this.playbackState.options?.profiles.filter(
                profile => profile.available === true && (container === undefined || typeof profile.modes[container] === 'number'),
            ) ?? []
        );
    }

    get selectedQualityLabel(): string {
        const profile = this.qualityProfiles.find(profile => profile.id === this.playbackState.selectedPresetId);
        return profile === undefined ? 'おまかせ (自動)' : getPlaybackShortLabel(profile, this.playbackState.options?.recommended);
    }

    /**
     * 画質一覧の開閉
     */
    public toggleQualityList(): void {
        this.isQualityListOpen = this.isQualityListOpen === false;
    }

    /**
     * 選択中の配信方式に合わせて画質の選択肢を読み込む。
     * 端末の設定画面の既定値 (既定の画質・映像補正・HDR・モバイル回線) はここでサーバへ渡される
     */
    private async loadPlaybackOptions(): Promise<void> {
        const channel = this.dialogState.getChannelItem();
        if (channel === null) return;

        const generation = ++this.loadGeneration;
        await this.playbackState.loadLive(channel.id, this.selectedContainer).catch(err => console.error(err));

        // 配信方式が続けて切り替えられた場合、古い応答は捨てる
        if (generation !== this.loadGeneration) return;

        // 「既定の画質」が明示指定されているときだけ配信設定へ反映する。
        // 自動 (auto) のときにサーバの推奨を書き込むと、このダイアログで前回選んだ設定を毎回上書きしてしまう
        if (this.playbackState.preference.preferredQuality !== 'auto') {
            this.applySelectedQualityToStreamConfig(this.playbackState.selectedPresetId);
        }
    }

    public selectQuality(id: string): void {
        this.playbackState.selectPreset(id);
        this.applySelectedQualityToStreamConfig(id);
    }

    /**
     * 選択した画質に対応するサーバ側の mode をストリーム設定へ反映する
     * @param id: string プリセット識別子
     */
    private applySelectedQualityToStreamConfig(id: string): void {
        const container = this.selectedContainer;
        if (container === undefined) return;

        const mode = this.qualityProfiles.find(profile => profile.id === id)?.modes[container];
        if (typeof mode === 'number' && this.dialogState.streamConfigItems.some(item => item.value === mode) === true) {
            this.dialogState.selectedStreamConfig = mode;
        }
    }

    public beforeUnmount(): void {
        this.dialogState.close();
    }

    /**
     * 配信設定セレクタを手で変更したときに、画質の選択表示を追随させる。
     * 画質選択由来の変更 (applySelectedQualityToStreamConfig) は既に選択済みの画質と一致する mode を書き戻すだけなので、
     * ここで selectPreset を呼び直しても実質的な変化は起きず、逆流ループにはならない
     */
    @Watch('dialogState.selectedStreamConfig')
    public onChangeSelectedStreamConfig(mode: number | undefined): void {
        if (typeof mode !== 'number') return;
        const container = this.selectedContainer;
        if (container === undefined) return;

        // 既に選択中の画質がその mode なら触らない (画質選択由来の書き戻しで表示が動かないようにする)
        const current = this.qualityProfiles.find(profile => profile.id === this.playbackState.selectedPresetId);
        if (current !== undefined && current.modes[container] === mode) return;

        // 「おまかせ」は解決先プリセットと同じ mode を持つため、先に具体的なプリセットを探す。
        // ここで find の先頭一致に任せると、手で選んだ画質が毎回「おまかせ」へ巻き戻る
        const matched =
            this.qualityProfiles.find(profile => profile.id !== 'auto' && profile.modes[container] === mode) ??
            this.qualityProfiles.find(profile => profile.modes[container] === mode);
        if (matched !== undefined) this.playbackState.selectPreset(matched.id);
    }

    public updateAllStreamConfig(): void {
        this.dialogState.updateStreamTypes();
        this.dialogState.updateStreamConfig();
        void this.loadPlaybackOptions();

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
        void this.loadPlaybackOptions();

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
        if (newState === true && oldState !== true) {
            // 「再生前に画質を選ぶ」設定のときだけ最初から一覧を開く
            this.isQualityListOpen = this.playbackState.preference.autoPlayWithRecommendedQuality === false;
            void this.loadPlaybackOptions();
        }
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

<style lang="sass" scoped>
// 画質一覧を開くとダイアログが縦に伸びるため、狭い端末でも本文側だけスクロールさせる
.select-stream-body
    max-height: min(60svh, 520px)
    overflow-y: auto

.quality-list
    max-height: 40svh
    overflow-y: auto
</style>
