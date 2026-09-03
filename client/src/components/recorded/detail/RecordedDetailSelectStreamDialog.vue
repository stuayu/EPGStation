<template>
    <div class="recorded-detail-select-stream">
        <v-dialog v-if="isRemove === false" v-model="dialogState.isOpen" max-width="400" scrollable>
            <v-card v-if="dialogState.title !== null">
                <div class="pa-4 pb-0 select-stream-body">
                    <div>{{ dialogState.title }}</div>
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
                    <div class="d-flex flex-wrap">
                        <v-select
                            :items="dialogState.streamTypeItems"
                            v-model="dialogState.selectedStreamType"
                            v-on:update:model-value="updateModeItems"
                            style="max-width: 120px"
                            hint="配信方式を変えると選べる画質も変わります"
                            persistent-hint
                        ></v-select>
                        <v-select
                            v-if="isHiddenStreamMode === false"
                            :items="dialogState.streamModeItems"
                            v-model="dialogState.selectedStreamMode"
                        ></v-select>
                    </div>
                </div>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn color="primary" variant="text" min-height="44" v-on:click="cancel">キャンセル</v-btn>
                    <v-btn color="primary" variant="text" min-height="44" v-on:click="view">視聴</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IRecordedDetailSelectStreamState, { RecordedStreamType } from '@/model/state/recorded/detail/IRecordedDetailSelectStreamState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../../api';
import PlaybackQualityList from '@/components/video/quality/PlaybackQualityList.vue';
import IPlaybackOptionsState from '@/model/state/video/IPlaybackOptionsState';
import { getPlaybackShortLabel } from '@/util/PlaybackLabelUtil';

// 配信方式ごとの playback-options 上のコンテナ名
const STREAM_TYPE_CONTAINERS: { [key in RecordedStreamType]: Exclude<apid.PlaybackContainer, 'normal'> } = {
    WebM: 'webm',
    MP4: 'mp4',
    HLS: 'hls',
};

@Component({ components: { PlaybackQualityList } })
class RecordedDetailSelectStreamDialog extends Vue {
    public dialogState: IRecordedDetailSelectStreamState = container.get<IRecordedDetailSelectStreamState>('IRecordedDetailSelectStreamState');
    public isRemove: boolean = false;
    // ストリーム視聴設定セレクタ再描画用
    public isHiddenStreamMode: boolean = false;

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
        const videoFileId = this.dialogState.getVideoFileId();
        if (videoFileId === null) return;

        const generation = ++this.loadGeneration;
        await this.playbackState.loadRecorded(videoFileId, this.selectedContainer).catch(err => console.error(err));

        // 配信方式が続けて切り替えられた場合、古い応答は捨てる
        if (generation !== this.loadGeneration) return;

        // 「既定の画質」が明示指定されているときだけ配信設定へ反映する。
        // 自動 (auto) のときにサーバの推奨を書き込むと、このダイアログで前回選んだ設定を毎回上書きしてしまう
        if (this.playbackState.preference.preferredQuality !== 'auto') {
            this.applySelectedQualityToStreamMode(this.playbackState.selectedPresetId);
        }
    }

    public selectQuality(id: string): void {
        this.playbackState.selectPreset(id);
        this.applySelectedQualityToStreamMode(id);
    }

    /**
     * 選択した画質に対応するサーバ側の mode をストリーム設定へ反映する
     * @param id: string プリセット識別子
     */
    private applySelectedQualityToStreamMode(id: string): void {
        const container = this.selectedContainer;
        if (container === undefined) return;

        const mode = this.qualityProfiles.find(profile => profile.id === id)?.modes[container];
        if (typeof mode === 'number' && this.dialogState.streamModeItems.some(item => item.value === mode) === true) {
            this.dialogState.selectedStreamMode = mode;
        }
    }

    public beforeUnmount(): void {
        this.dialogState.close();
    }

    /**
     * 配信設定セレクタを手で変更したときに、画質の選択表示を追随させる。
     * 画質選択由来の変更 (applySelectedQualityToStreamMode) は既に選択済みの画質と一致する mode を書き戻すだけなので、
     * ここで selectPreset を呼び直しても実質的な変化は起きず、逆流ループにはならない
     */
    @Watch('dialogState.selectedStreamMode')
    public onChangeSelectedStreamMode(mode: number | undefined): void {
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

    public updateModeItems(): void {
        this.dialogState.updateModeItems();
        void this.loadPlaybackOptions();

        // 再描画
        this.isHiddenStreamMode = true;
        this.$nextTick(() => {
            this.isHiddenStreamMode = false;
        });
    }

    public cancel(): void {
        this.dialogState.isOpen = false;
    }

    public async view(): Promise<void> {
        if (typeof this.dialogState.selectedStreamType === 'undefined' || typeof this.dialogState.selectedStreamMode === 'undefined') {
            this.snackbarState.open({
                color: 'error',
                text: '配信設定が正しく入力されていません',
            });

            return;
        }

        const recordedId = this.dialogState.getRecordedId();
        if (recordedId === null) {
            this.snackbarState.open({
                color: 'error',
                text: '番組 ID が不正です',
            });

            return;
        }

        await Util.move(this.$router, {
            path: `/recorded/streaming/${this.dialogState.getVideoFileId()}`,
            query: {
                recordedId: recordedId.toString(),
                streamingType: this.dialogState.selectedStreamType.toLowerCase(),
                mode: this.dialogState.selectedStreamMode.toString(10),
            },
        });
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

export default toNative(RecordedDetailSelectStreamDialog);
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
