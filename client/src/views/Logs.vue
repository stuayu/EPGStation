<template>
    <v-main>
        <TitleBar title="ログ">
            <template v-slot:menu>
                <v-btn icon variant="text" :disabled="logState.isLoading === true" v-on:click="reload">
                    <v-icon>mdi-refresh</v-icon>
                </v-btn>
            </template>
        </TitleBar>
        <transition name="page">
            <div ref="appContent" class="app-content log-content">
                <v-container>
                    <div v-if="logState.getProcessTabs().length === 0" class="pa-4 text-medium-emphasis">
                        表示できるログファイルがありません。
                    </div>
                    <template v-else>
                        <!-- プロセス別タブ -->
                        <v-tabs v-model="processTab" show-arrows class="mb-2">
                            <v-tab v-for="tab in logState.getProcessTabs()" v-bind:key="tab.process" :value="tab.process">
                                {{ tab.name }}
                            </v-tab>
                        </v-tabs>

                        <!-- カテゴリ別タブ -->
                        <v-tabs v-model="categoryTab" show-arrows density="compact" class="mb-3">
                            <v-tab v-for="tab in logState.getCategoryTabs()" v-bind:key="tab.category" :value="tab.category">
                                {{ tab.category }}
                            </v-tab>
                        </v-tabs>

                        <!-- 操作パネル -->
                        <div class="d-flex flex-wrap align-center ga-3 mb-3">
                            <v-select
                                v-model="fileId"
                                :items="fileSelectItems"
                                item-title="title"
                                item-value="value"
                                label="ファイル"
                                density="compact"
                                hide-details
                                variant="outlined"
                                class="file-select"
                            ></v-select>
                            <v-select
                                v-model="displayLines"
                                :items="lineOptions"
                                label="表示行数"
                                density="compact"
                                hide-details
                                variant="outlined"
                                class="lines-select"
                            ></v-select>
                            <v-text-field
                                v-model="keyword"
                                label="キーワードで絞り込み"
                                density="compact"
                                hide-details
                                clearable
                                variant="outlined"
                                prepend-inner-icon="mdi-magnify"
                                class="keyword-field"
                            ></v-text-field>
                            <v-switch v-model="isAutoReload" label="自動更新" color="primary" hide-details density="compact"></v-switch>
                            <v-switch v-model="isTailMode" label="末尾追従" color="primary" hide-details density="compact"></v-switch>
                            <v-spacer></v-spacer>
                            <v-btn variant="text" prepend-icon="mdi-download" :disabled="downloadUrl === null" :href="downloadHref" download>
                                ダウンロード
                            </v-btn>
                        </div>

                        <!-- ファイル情報 -->
                        <div v-if="selectedFile !== null" class="d-flex flex-wrap align-center text-body-2 text-medium-emphasis mb-2">
                            <div class="mr-4">{{ selectedFile.name }}</div>
                            <div class="mr-4">{{ fileSizeStr }}</div>
                            <div class="mr-4">更新: {{ updatedAtStr }}</div>
                            <div class="mr-4">{{ logState.lines.length }} 行表示中</div>
                        </div>

                        <v-alert v-if="logState.isTruncated === true" type="info" variant="tonal" density="compact" class="mb-2">
                            ログが大きいため、末尾から一部のみを表示しています。全体を確認するにはダウンロードしてください。
                        </v-alert>

                        <v-progress-linear v-if="logState.isLoading === true" indeterminate></v-progress-linear>

                        <!-- ログ本体 -->
                        <v-card variant="outlined" class="log-viewer">
                            <div ref="logBody" class="log-body">
                                <div v-if="logState.lines.length === 0" class="pa-4 text-medium-emphasis">
                                    表示するログがありません。
                                </div>
                                <!-- 時刻・レベル・カテゴリ・本文に分けて表示する (パターンに合わない行は本文のみ) -->
                                <div v-for="(line, index) in parsedLines" v-bind:key="index" class="log-line" v-bind:class="`level-${line.level.toLowerCase()}`">
                                    <span v-if="line.timestamp !== null" class="log-timestamp">{{ line.timestamp }}</span>
                                    <span v-if="line.level !== 'UNKNOWN'" class="log-level">{{ line.level }}</span>
                                    <span v-if="line.category !== null" class="log-category">{{ line.category }}</span>
                                    <span class="log-message">
                                        <template v-for="(part, i) in highlight(line.message)" v-bind:key="i">
                                            <mark v-if="part.matched === true" class="log-keyword">{{ part.text }}</mark>
                                            <template v-else>{{ part.text }}</template>
                                        </template>
                                    </span>
                                </div>
                            </div>
                        </v-card>
                    </template>
                </v-container>
            </div>
        </transition>
    </v-main>
</template>

<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import ILogState from '@/model/state/log/ILogState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import DateUtil from '@/util/DateUtil';
import { HighlightedPart, ParsedLogLine, parseLogLine, splitByKeyword } from '@/util/LogLineParser';
import Util from '@/util/Util';
import { Component, Vue, Watch, toNative } from 'vue-facing-decorator';
import * as apid from '../../../api';

interface FileSelectItem {
    title: string;
    value: string;
}

@Component({
    components: {
        TitleBar,
    },
})
class Logs extends Vue {
    public logState: ILogState = container.get<ILogState>('ILogState');
    public isAutoReload: boolean = false;
    public isTailMode: boolean = true;

    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private timerId: ReturnType<typeof setInterval> | null = null;
    private keywordTimerId: ReturnType<typeof setTimeout> | null = null;

    /**
     * プロセスタブ
     */
    get processTab(): apid.LogProcessType | null {
        return this.logState.selectedProcess;
    }
    set processTab(value: apid.LogProcessType | null) {
        if (value === null) {
            return;
        }

        this.logState.selectProcess(value);
        this.fetchContent();
    }

    /**
     * カテゴリタブ
     */
    get categoryTab(): string | null {
        return this.logState.selectedCategory;
    }
    set categoryTab(value: string | null) {
        if (value === null) {
            return;
        }

        this.logState.selectCategory(value);
        this.fetchContent();
    }

    /**
     * 表示対象ファイル
     */
    get fileId(): string | null {
        return this.logState.selectedFileId;
    }
    set fileId(value: string | null) {
        if (value === null) {
            return;
        }

        this.logState.selectFile(value);
        this.fetchContent();
    }

    /**
     * 表示行数
     */
    get displayLines(): number {
        return this.logState.displayLines;
    }
    set displayLines(value: number) {
        this.logState.displayLines = value;
        this.fetchContent();
    }

    /**
     * 絞り込みキーワード
     */
    get keyword(): string {
        return this.logState.keyword;
    }
    set keyword(value: string | null) {
        this.logState.keyword = value === null ? '' : value;

        // 入力のたびにリクエストしないよう遅延させる
        if (this.keywordTimerId !== null) {
            clearTimeout(this.keywordTimerId);
        }
        this.keywordTimerId = setTimeout(() => {
            this.fetchContent();
        }, Logs.KEYWORD_DELAY);
    }

    get lineOptions(): number[] {
        return Logs.LINE_OPTIONS;
    }

    /**
     * ファイル選択リスト (現行ログ / ローテート済み)
     */
    get fileSelectItems(): FileSelectItem[] {
        return this.logState.getFiles().map(f => {
            return {
                title: f.isRotated === false ? `${f.name} (最新)` : f.name,
                value: f.id,
            };
        });
    }

    get selectedFile(): apid.LogFileItem | null {
        return this.logState.getSelectedFile();
    }

    get downloadUrl(): string | null {
        return this.logState.getDownloadUrl();
    }

    /**
     * v-btn の href に渡す値 (null は許容されないため undefined にする)
     */
    get downloadHref(): string | undefined {
        return this.logState.getDownloadUrl() ?? undefined;
    }

    get fileSizeStr(): string {
        const file = this.selectedFile;

        return file === null ? '' : Util.getFileSizeStr(file.size);
    }

    get updatedAtStr(): string {
        const file = this.selectedFile;

        return file === null ? '' : DateUtil.format(DateUtil.getJaDate(new Date(file.updatedAt)), 'yyyy/MM/dd hh:mm:ss');
    }

    /**
     * 表示中のログを構造 (時刻・レベル・カテゴリ・本文) へ分解したもの
     */
    get parsedLines(): ParsedLogLine[] {
        return this.logState.lines.map(line => parseLogLine(line));
    }

    /**
     * 本文を絞り込みキーワードで分割する (強調表示用)
     * @param message: string
     * @return HighlightedPart[]
     */
    public highlight(message: string): HighlightedPart[] {
        return splitByKeyword(message, this.logState.keyword);
    }

    /**
     * 手動リロード
     */
    public async reload(): Promise<void> {
        await this.fetchFiles();
        await this.fetchContent();
    }

    public created(): void {
        this.startAutoReload();
    }

    public beforeUnmount(): void {
        this.stopAutoReload();

        if (this.keywordTimerId !== null) {
            clearTimeout(this.keywordTimerId);
            this.keywordTimerId = null;
        }
    }

    @Watch('isAutoReload')
    public onChangeAutoReload(): void {
        this.startAutoReload();
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.logState.clearData();
        this.$nextTick(async () => {
            await this.reload();

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }

    /**
     * ログファイル一覧取得
     */
    private async fetchFiles(): Promise<void> {
        await this.logState.fetchFiles().catch(err => {
            this.snackbarState.open({
                color: 'error',
                text: 'ログファイル一覧の取得に失敗',
            });
            console.error(err);
        });
    }

    /**
     * ログ内容取得
     */
    private async fetchContent(): Promise<void> {
        await this.logState.fetchContent().catch(err => {
            this.snackbarState.open({
                color: 'error',
                text: 'ログの取得に失敗',
            });
            console.error(err);
        });

        this.$nextTick(() => {
            this.scrollToBottom();
        });
    }

    /**
     * 末尾追従が有効な場合は一番下へスクロールする
     */
    private scrollToBottom(): void {
        if (this.isTailMode === false) {
            return;
        }

        const body = this.$refs.logBody as HTMLElement | undefined;
        if (typeof body === 'undefined') {
            return;
        }

        body.scrollTop = body.scrollHeight;
    }

    /**
     * 自動更新の開始 / 停止
     */
    private startAutoReload(): void {
        this.stopAutoReload();

        if (this.isAutoReload === false) {
            return;
        }

        this.timerId = setInterval(async () => {
            await this.fetchFiles();
            await this.fetchContent();
        }, Logs.AUTO_RELOAD_INTERVAL);
    }

    private stopAutoReload(): void {
        if (this.timerId === null) {
            return;
        }

        clearInterval(this.timerId);
        this.timerId = null;
    }
}

namespace Logs {
    export const LINE_OPTIONS = [100, 200, 500, 1000, 2000, 5000];
    export const AUTO_RELOAD_INTERVAL = 5000;
    export const KEYWORD_DELAY = 400;
}

export default toNative(Logs);
</script>

<style lang="sass" scoped>
.file-select
    min-width: 260px
    max-width: 420px

.lines-select
    min-width: 120px
    max-width: 160px

.keyword-field
    min-width: 200px
    max-width: 320px

.log-viewer
    overflow: hidden

.log-body
    max-height: calc(100vh - 340px)
    min-height: 240px
    overflow: auto
    padding: 8px 12px
    font-family: 'Consolas', 'Menlo', 'Monaco', monospace
    font-size: 12px
    line-height: 1.6

    .log-line
        display: flex
        flex-wrap: wrap
        align-items: baseline
        gap: 0 8px
        white-space: pre-wrap
        overflow-wrap: anywhere
        padding: 1px 0

        // レベルごとに行の色分けと左のライン (一覧の中でエラーを見つけやすくする)
        &.level-error, &.level-fatal
            color: #ff5252
            background: rgba(255, 82, 82, 0.08)
            border-left: 3px solid #ff5252
            padding-left: 5px

        &.level-warn
            color: #fb8c00
            background: rgba(251, 140, 0, 0.08)
            border-left: 3px solid #fb8c00
            padding-left: 5px

        &.level-debug, &.level-trace
            opacity: 0.7

        // パターンに合わない行 (スタックトレースの続きなど) は本文をぶら下げる
        &.level-unknown
            padding-left: 8px

    .log-timestamp
        flex: 0 0 auto
        opacity: 0.6
        font-variant-numeric: tabular-nums

    .log-level
        flex: 0 0 auto
        min-width: 3.5em
        font-weight: bold
        text-align: center
        border-radius: 3px
        padding: 0 4px
        background: rgba(127, 127, 127, 0.15)

    .log-category
        flex: 0 0 auto
        opacity: 0.75

    .log-message
        flex: 1 1 240px
        min-width: 0
        white-space: pre-wrap

    .log-keyword
        background: rgba(255, 235, 59, 0.45)
        color: inherit
        border-radius: 2px
        padding: 0 1px
</style>
