<template>
    <v-dialog v-model="isOpen" max-width="420" scrollable>
        <v-card v-if="videoFile !== null">
            <v-card-title class="text-subtitle-1">{{ title }}</v-card-title>
            <v-card-text>
                <div class="text-caption mb-2">{{ videoFile.name }} ({{ videoFile.type === 'ts' ? 'TS' : 'エンコード済み' }})</div>
                <template v-if="isStreamingAvailable === true">
                    <div class="text-caption">ストリーミング設定</div>
                    <div class="d-flex ga-2">
                        <v-select
                            :items="streamState.streamTypeItems"
                            v-model="streamState.selectedStreamType"
                            v-on:update:model-value="updateModeItems"
                            density="compact"
                            hide-details
                            style="max-width: 120px"
                        ></v-select>
                        <v-select
                            v-if="isHiddenStreamMode === false"
                            :items="streamState.streamModeItems"
                            v-model="streamState.selectedStreamMode"
                            density="compact"
                            hide-details
                        ></v-select>
                    </div>
                </template>
                <div v-else class="text-caption">この録画に使えるストリーミング設定がありません</div>
            </v-card-text>
            <v-card-actions>
                <v-btn variant="text" v-on:click="close">キャンセル</v-btn>
                <v-spacer></v-spacer>
                <v-btn v-if="canPlayDirectly === true" color="primary" variant="text" v-on:click="playDirectly">そのまま再生</v-btn>
                <v-btn v-if="isStreamingAvailable === true" color="primary" variant="text" v-on:click="playStreaming">ストリーミング</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IRecordedDetailSelectStreamState from '@/model/state/recorded/detail/IRecordedDetailSelectStreamState';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../api';

/**
 * 視聴履歴一覧から再生方法を選ぶダイアログ。
 * 「そのまま再生 (ブラウザで直接再生)」と「ストリーミング再生 (配信種別・画質を選ぶ)」を選択させる。
 * 配信設定の組み立ては録画詳細と同じ IRecordedDetailSelectStreamState を使う
 */
@Component({})
class WatchHistoryPlayDialog extends Vue {
    @Prop({ required: true }) public modelValue!: boolean;
    @Prop({ default: null }) public videoFile!: apid.VideoFile | null;
    @Prop({ default: null }) public recordedId!: apid.RecordedId | null;
    @Prop({ default: '' }) public title!: string;

    public streamState: IRecordedDetailSelectStreamState = container.get<IRecordedDetailSelectStreamState>('IRecordedDetailSelectStreamState');

    // この録画に使える配信設定があるか (config で無効・未設定の場合は false)
    public isStreamingAvailable: boolean = false;
    // 視聴設定セレクタ再描画用
    public isHiddenStreamMode: boolean = false;

    get isOpen(): boolean {
        return this.modelValue;
    }

    set isOpen(value: boolean) {
        this.$emit('update:modelValue', value);
    }

    /**
     * 「そのまま再生」を出すか
     * エンコード済みは常に出す。TS は直接再生できないが、
     * 配信設定が無く他に手段が無い場合だけ最後の手段として出す
     */
    get canPlayDirectly(): boolean {
        return this.videoFile !== null && (this.videoFile.type === 'encoded' || this.isStreamingAvailable === false);
    }

    @Watch('modelValue')
    public onChangeOpenState(value: boolean): void {
        if (value === false) {
            return;
        }

        this.isStreamingAvailable = false;
        if (this.videoFile === null || this.recordedId === null) {
            return;
        }

        try {
            // ビデオ形式に対応した配信設定が無い場合は例外になる
            this.streamState.open(this.videoFile, this.recordedId);
            this.isStreamingAvailable = this.streamState.streamTypeItems.length > 0;
        } catch (err) {
            console.error(err);
            this.isStreamingAvailable = false;
        }
    }

    public updateModeItems(): void {
        this.streamState.updateModeItems();

        // 再描画
        this.isHiddenStreamMode = true;
        this.$nextTick(() => {
            this.isHiddenStreamMode = false;
        });
    }

    public close(): void {
        this.isOpen = false;
    }

    /**
     * ブラウザで直接再生する
     */
    public async playDirectly(): Promise<void> {
        if (this.videoFile === null || this.recordedId === null) {
            return;
        }

        this.isOpen = false;
        await Util.move(this.$router, {
            path: '/recorded/watch',
            query: {
                videoId: this.videoFile.id.toString(10),
                recordedId: this.recordedId.toString(10),
            },
        });
    }

    /**
     * 選択した配信設定でストリーミング再生する
     */
    public async playStreaming(): Promise<void> {
        if (
            this.videoFile === null ||
            this.recordedId === null ||
            typeof this.streamState.selectedStreamType === 'undefined' ||
            typeof this.streamState.selectedStreamMode === 'undefined'
        ) {
            return;
        }

        const streamingType = this.streamState.selectedStreamType.toLowerCase();
        const mode = this.streamState.selectedStreamMode.toString(10);
        const videoFileId = this.videoFile.id;
        const recordedId = this.recordedId;

        // 選択した配信設定を保存する
        this.streamState.close();
        this.isOpen = false;

        await Util.move(this.$router, {
            path: `/recorded/streaming/${videoFileId}`,
            query: {
                recordedId: recordedId.toString(10),
                streamingType: streamingType,
                mode: mode,
            },
        });
    }
}

export default toNative(WatchHistoryPlayDialog);
</script>
