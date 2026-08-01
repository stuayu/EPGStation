<template>
    <div class="pa-4">
        <v-radio-group :model-value="uploadState.isAutoDetect" v-on:update:model-value="changeAutoDetect" hide-details class="mb-2">
            <v-radio :value="true" label="TS ファイル (番組情報をサーバーで自動取得)"></v-radio>
            <v-radio :value="false" label="エンコード済みファイル (番組情報を入力する)"></v-radio>
        </v-radio-group>
        <div v-if="uploadState.isAutoDetect === true" class="text-caption text-medium-emphasis mb-3">
            放送 TS の PSI/SI から放送局・番組名・開始時刻・ジャンルを取り出して番組情報を作ります。放送局が特定できない TS や、PSI/SI を持たないファイルは登録できません。
        </div>
        <template v-if="uploadState.isAutoDetect === false">
            <SearchOptionRow title="放送局※" :required="true">
                <v-select label="channel" :items="uploadState.getChannelItems()" v-model="uploadState.programOption.channelId" clearable></v-select>
            </SearchOptionRow>
            <SearchOptionRow title="ジャンル">
                <div class="d-flex">
                    <v-select label="genre" :items="uploadState.getGenreItems()" v-model="uploadState.programOption.genre1" clearable style="width: 50%"></v-select>
                    <v-select label="sub genre" :items="uploadState.getSubGenreItems()" v-model="uploadState.programOption.subGenre1" clearable style="width: 50%"></v-select>
                </div>
            </SearchOptionRow>
            <SearchOptionRow title="ルール">
                <v-autocomplete
                    v-model="uploadState.programOption.ruleId"
                    :loading="ruleLoading"
                    :items="uploadState.ruleItems"
                    v-model:search="ruleSearchInput"
                    item-title="keyword"
                    item-value="id"
                    cache-items
                    flat
                    hide-no-data
                    hide-details
                    clearable
                    label="ルール"
                    class="pb-2"
                ></v-autocomplete>
            </SearchOptionRow>
            <SearchOptionRow title="日付※" :required="true">
                <v-datetime-picker
                    v-if="uploadState.isShowPeriod === true"
                    label="開始"
                    clearText="クリア"
                    okText="設定"
                    v-model="uploadState.programOption.startAt"
                    :datePickerProps="{
                        locale: 'jp-ja',
                        'day-format': formatDay,
                        'first-day-of-week': 1,
                    }"
                    :timePickerProps="{
                        'ampm-in-title': true,
                    }"
                    :textFieldProps="{
                        color: 'success',
                    }"
                >
                    <template #actions="{ parent }">
                        <v-btn variant="text" color="primary" @click="parent.clearHandler">クリア</v-btn>
                        <v-btn variant="text" color="primary" @click="parent.okHandler">設定</v-btn>
                    </template>
                </v-datetime-picker>
            </SearchOptionRow>
            <SearchOptionRow title="長さ※" :required="true">
                <v-text-field v-model.number="uploadState.programOption.duration" min="1" label="長さ(分)" type="number" clearable></v-text-field>
            </SearchOptionRow>
            <SearchOptionRow title="番組名※" :required="true">
                <v-text-field v-model="uploadState.programOption.name" label="name" clearable></v-text-field>
            </SearchOptionRow>
            <SearchOptionRow title="概要">
                <v-textarea label="description" v-model="uploadState.programOption.description"></v-textarea>
            </SearchOptionRow>
            <SearchOptionRow title="詳細">
                <v-textarea label="extended" v-model="uploadState.programOption.extended"></v-textarea>
            </SearchOptionRow>
        </template>
        <div v-for="video in uploadState.videoFileItems" v-bind:key="video.key">
            <SearchOptionRow :title="`ビデオファイル${video.key + 1}`">
                <v-text-field v-model="video.viewName" label="name" clearable class="view-name"></v-text-field>
                <v-select v-if="uploadState.isAutoDetect === false" class="file-type" v-model="video.fileType" :items="uploadState.getFileTypeItems()" label="file type"></v-select>

                <v-select class="directory" v-model="video.parentDirectoryName" :items="uploadState.getPrentDirectoryItems()" label="directory"></v-select>
                <v-text-field v-model="video.subDirectory" label="sub directory" clearable></v-text-field>
                <v-file-input v-model="video.file" label="video file" v-on:update:model-value="setViewName(video)"></v-file-input>
            </SearchOptionRow>
        </div>
    </div>
</template>

<script lang="ts">
import SearchOptionRow from '@/components/search/SearchOptionRow.vue';
import container from '@/model/ModelContainer';
import IRecordedUploadState, { VideoFileItem } from '@/model/state/recorded/upload/IRecordedUploadState';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';

/**
 * 録画ファイルのアップロード入力欄 (番組情報 + ビデオファイル指定)
 * アップロード画面と録画済み画面の取り込みダイアログの両方から使う
 */
@Component({
    components: {
        SearchOptionRow,
    },
})
class RecordedUploadFields extends Vue {
    public uploadState: IRecordedUploadState = container.get<IRecordedUploadState>('IRecordedUploadState');
    public ruleLoading: boolean = false;
    public ruleSearchInput: string | undefined;

    /**
     * 番組情報の自動取得モードを切り替える
     */
    public changeAutoDetect(value: boolean | null): void {
        this.uploadState.setAutoDetect(value === true);
    }

    public formatDay(date: string | number | Date): number {
        return new Date(date).getDate();
    }

    /**
     * 表示名が未入力ならファイル名で埋める
     * (番組情報を自動取得する場合、入力させたいのはファイルだけなので手間を減らす)
     */
    public setViewName(video: VideoFileItem): void {
        if (typeof video.viewName === 'string' && video.viewName.length > 0) return;
        if (typeof video.file === 'undefined' || video.file === null) return;

        video.viewName = video.file.name;
    }

    @Watch('ruleSearchInput', { immediate: true })
    public async onChangeSearch(newKeyword: string): Promise<void> {
        if (newKeyword === null || newKeyword === this.uploadState.ruleKeyword) {
            return;
        }

        this.uploadState.ruleKeyword = newKeyword;
        await this.uploadState.updateRuleItems();
    }
}

export default toNative(RecordedUploadFields);
</script>

<style lang="sass" scoped>
.view-name, .file-type, .directory
    max-width: 150px
</style>
