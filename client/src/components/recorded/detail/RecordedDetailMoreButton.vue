<template>
    <div>
        <v-menu v-model="isOpened" location="bottom start">
            <template v-slot:activator="{ props }">
                <v-btn icon variant="text" size="small" v-bind="props">
                    <v-icon>mdi-dots-vertical</v-icon>
                </v-btn>
            </template>
            <v-list>
                <v-list-item v-on:click="openDownloadDialog" slim>
                    <template #prepend>
                        <v-icon>mdi-download</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>download</v-list-item-title>
                    </div>
                </v-list-item>
                <v-list-item v-if="typeof recordedItem.ruleId !== 'undefined'" v-on:click="gotoRule" slim>
                    <template #prepend>
                        <v-icon>mdi-calendar</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>rule</v-list-item-title>
                    </div>
                </v-list-item>
                <v-list-item v-on:click="openUploadDialog" slim>
                    <template #prepend>
                        <v-icon>mdi-upload</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>ビデオファイルを追加</v-list-item-title>
                    </div>
                </v-list-item>
                <v-list-item v-if="isEnabledSeriesLibrary === true" v-on:click="editSeriesMapping" slim>
                    <template #prepend><v-icon>mdi-link-variant</v-icon></template>
                    <div class="v-list-item-content"><v-list-item-title>シリーズ割当を修正</v-list-item-title></div>
                </v-list-item>
                <!-- 取り込み済みの TS を再解析して番組情報 (概要・ジャンル・映像音声・放送局) を取り直す -->
                <v-list-item v-on:click="reanalyze" slim>
                    <template #prepend>
                        <v-icon>mdi-file-search</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>TS を再解析</v-list-item-title>
                    </div>
                </v-list-item>
                <v-list-item v-if="cmDetectionCandidates.length > 0" v-on:click="selectCmDetectionVideo" slim>
                    <template #prepend><v-icon>mdi-movie-open</v-icon></template>
                    <div class="v-list-item-content"><v-list-item-title>CM チャプターを推定 (試験的)</v-list-item-title></div>
                </v-list-item>
                <v-list-item v-on:click="search" slim>
                    <template #prepend>
                        <v-icon>mdi-magnify</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>search</v-list-item-title>
                    </div>
                </v-list-item>
                <v-list-item v-if="recordedItem.isProtected === true" v-on:click="unprotect" slim>
                    <template #prepend>
                        <v-icon>mdi-lock-open</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>unprotect</v-list-item-title>
                    </div>
                </v-list-item>
                <v-list-item v-else v-on:click="protect" slim>
                    <template #prepend>
                        <v-icon>mdi-lock</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>protect</v-list-item-title>
                    </div>
                </v-list-item>
                <v-list-item v-on:click="openDeleteDialog" slim>
                    <template #prepend>
                        <v-icon>mdi-delete</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>delete</v-list-item-title>
                    </div>
                </v-list-item>
            </v-list>
        </v-menu>
        <div v-if="isOpened === true" class="menu-background" v-on:click="onClickMenuBackground"></div>
        <RecordedDownloadDialog
            v-model:isOpen="isOpenDownloadDialog"
            :recordedItem="recordedItem"
            v-on:download="downloadVideo"
            v-on:downloadPlayList="downloadPlayList"
        ></RecordedDownloadDialog>
        <RecordedUploadVideoDialog v-model:isOpen="isOpenUploadDialog" :recordedItem="recordedItem" v-on:uploaded="uploaded"></RecordedUploadVideoDialog>
        <RecordedDeleteDialog
            v-model:isOpen="isOpenDeleteDialog"
            :recordedItem="recordedItem"
            :isDelaySnackbarViewNum="800"
            v-on:deleteSuccessful="deleteSuccessful"
        ></RecordedDeleteDialog>
        <v-dialog v-model="isOpenCmDetectionDialog" :fullscreen="isMobile" max-width="520" scrollable>
            <v-card v-if="isOpenCmDetectionDialog">
                <v-card-title>CM チャプターを推定</v-card-title>
                <v-card-text class="menu-card-body">
                    <v-list>
                        <v-list-item v-for="video in cmDetectionCandidates" :key="video.id" @click="detectCm(video)">
                            <v-list-item-title>{{ video.name }}</v-list-item-title>
                        </v-list-item>
                    </v-list>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="isOpenCmDetectionDialog = false">キャンセル</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts">
import RecordedDeleteDialog from '@/components/recorded/RecordedDeleteDialog.vue';
import RecordedDownloadDialog from '@/components/recorded/RecordedDownloadDialog.vue';
import RecordedUploadVideoDialog from '@/components/recorded/detail/RecordedUploadVideoDialog.vue';
import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import container from '@/model/ModelContainer';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { isFeatureEnabled } from '@/util/FeatureFlags';
import StrUtil from '@/util/StrUtil';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../../api';

@Component({
    components: {
        RecordedDownloadDialog,
        RecordedDeleteDialog,
        RecordedUploadVideoDialog,
    },
})
class RecordedDetailMoreButton extends Vue {
    @Prop({ required: true })
    public recordedItem!: apid.RecordedItem;

    public isOpened: boolean = false;

    public isOpenDeleteDialog: boolean = false;
    public isOpenDownloadDialog: boolean = false;
    public isOpenUploadDialog: boolean = false;
    public isOpenCmDetectionDialog = false;
    public cmDetectionCandidates: apid.VideoFile[] = [];

    public recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    private videoApiModel = container.get<IVideoApiModel>('IVideoApiModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private serverConfigModel: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');

    /**
     * シリーズライブラリ機能が有効か (featureFlags.seriesLibrary)
     */
    public get isEnabledSeriesLibrary(): boolean {
        return isFeatureEnabled(this.serverConfigModel.getConfig(), 'seriesLibrary');
    }

    public get isMobile(): boolean {
        return this.$vuetify.display.smAndDown;
    }

    @Watch('isOpened')
    public async onMenuStateChanged(isOpened: boolean): Promise<void> {
        if (isOpened === false) return;
        this.cmDetectionCandidates = [];
        if (this.serverConfigModel.getConfig()?.cmDetection?.enabled !== true) return;
        const tsFiles = (this.recordedItem.videoFiles ?? []).filter(video => video.type === 'ts');
        const checks = await Promise.all(
            tsFiles.map(async video => {
                try {
                    return (await this.videoApiModel.getChapters(video.id)).length === 0 ? video : null;
                } catch (_err) {
                    return null;
                }
            }),
        );
        if (this.isOpened) this.cmDetectionCandidates = checks.filter((video): video is apid.VideoFile => video !== null);
    }

    public async selectCmDetectionVideo(): Promise<void> {
        this.isOpened = false;
        if (this.cmDetectionCandidates.length === 1) {
            await this.detectCm(this.cmDetectionCandidates[0]);
            return;
        }
        await Util.sleep(300);
        this.isOpenCmDetectionDialog = true;
    }

    public async detectCm(video: apid.VideoFile): Promise<void> {
        this.isOpenCmDetectionDialog = false;
        try {
            await this.videoApiModel.detectCm(video.id);
            this.snackbarState.open({ color: 'success', text: 'CM チャプターの推定を開始しました。完了まで数十秒かかります' });
        } catch (err: any) {
            const status = err?.response?.status;
            const message = err?.response?.data?.message;
            this.snackbarState.open({
                color: 'error',
                text:
                    status === 409 && message === 'VideoFileAlreadyHasChapters'
                        ? 'この動画には既にチャプターがあります'
                        : status === 409
                          ? 'CM チャプターの推定は無効です'
                          : status === 400
                            ? 'TS ファイル以外は推定できません'
                            : 'CM チャプターの推定を開始できませんでした',
            });
        }
    }

    public async openUploadDialog(): Promise<void> {
        await Util.sleep(300);
        this.isOpenUploadDialog = true;
    }

    /**
     * ビデオファイルの追加後は一覧を取り直す (親側で再取得させる)
     */
    public uploaded(): void {
        this.$emit('uploaded');
    }

    public async openDownloadDialog(): Promise<void> {
        await Util.sleep(300);
        this.isOpenDownloadDialog = true;
    }

    public async gotoRule(): Promise<void> {
        if (typeof this.recordedItem.ruleId === 'undefined') {
            return;
        }

        await Util.sleep(300);
        Util.move(this.$router, {
            path: '/search',
            query: {
                rule: this.recordedItem.ruleId.toString(10),
            },
        });
    }

    public async unprotect(): Promise<void> {
        try {
            await this.recordedApiModel.unprotect(this.recordedItem.id);
            this.snackbarState.open({
                color: 'success',
                text: '保護解除に成功',
            });
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: '保護解除に失敗',
            });
        }
    }

    public async protect(): Promise<void> {
        try {
            await this.recordedApiModel.protect(this.recordedItem.id);
            this.snackbarState.open({
                color: 'success',
                text: '保護に成功',
            });
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: '保護に失敗',
            });
        }
    }

    /**
     * この録画のビデオファイルだけ TS を解析し直す。
     * 解析ロジックの更新後や、取り込み時に番組情報が入らなかった録画の補完に使う
     */
    public async reanalyze(): Promise<void> {
        await Util.sleep(300);
        try {
            await this.videoApiModel.startAnalyzeJob({ type: 'tsInfo', recordedId: this.recordedItem.id });
            this.snackbarState.open({ color: 'success', text: 'TS の再解析を開始しました' });
        } catch (err: any) {
            console.error(err);
            const status = err?.response?.status;
            this.snackbarState.open({
                color: 'error',
                text:
                    status === 409
                        ? '他の解析ジョブが実行中です'
                        : status === 404
                          ? '解析できるビデオファイルがありません'
                          : 'TS の再解析に失敗しました',
            });
        }
    }

    public async editSeriesMapping(): Promise<void> {
        await Util.sleep(300);
        await Util.move(this.$router, { path: `/recorded/${this.recordedItem.id}/series-mapping` });
    }

    public async search(): Promise<void> {
        await Util.sleep(300);

        if (typeof this.recordedItem.ruleId !== 'undefined') {
            Util.move(this.$router, {
                path: '/recorded',
                query: {
                    ruleId: this.recordedItem.ruleId.toString(10),
                },
            });
        }

        // recorded 絞り込み
        Util.move(this.$router, {
            path: '/recorded',
            query: {
                keyword: StrUtil.createSearchKeyword(this.recordedItem.name),
            },
        });
    }

    public async openDeleteDialog(): Promise<void> {
        await Util.sleep(300);
        this.isOpenDeleteDialog = true;
    }

    public onClickMenuBackground(e: Event): boolean {
        e.stopPropagation();

        return false;
    }

    public deleteSuccessful(deleteSuccessful: boolean): void {
        if (deleteSuccessful === true) {
            this.$router.back();
        }
    }

    public downloadVideo(video: apid.VideoFile): void {
        this.$emit('download', video);
    }

    public downloadPlayList(video: apid.VideoFile): void {
        this.$emit('downloadPlayList', video);
    }
}

export default toNative(RecordedDetailMoreButton);
</script>
