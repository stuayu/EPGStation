<template>
    <div class="sns-capture-attachment">
        <div v-if="captures.length > 0" class="captures-header text-caption">
            キャプチャ {{ captures.length }} 件 ・ 添付 {{ attachedCount }}/{{ maxAttached }}
        </div>

        <div v-if="captures.length > 0" class="capture-list">
            <div v-for="(cap, i) in captures" v-bind:key="cap.id" class="capture-item" v-bind:class="{ 'is-attached': cap.isAttached === true }">
                <div class="capture-main">
                    <div class="capture-thumb" v-on:click="openPreview(cap)">
                        <img v-bind:src="cap.dataUrl" />
                    </div>
                    <div class="capture-meta">
                        <div class="text-caption capture-time">{{ formatCapturedAt(cap.capturedAt) }}</div>
                        <div class="text-caption capture-program">{{ cap.programName ?? '番組名なし' }}</div>
                        <div class="capture-flags">
                            <v-icon v-if="cap.isDownloaded === true" size="12" title="ダウンロード済み">mdi-download</v-icon>
                            <v-icon v-if="cap.isPosted === true" size="12" title="投稿済み">mdi-send</v-icon>
                        </div>
                    </div>
                </div>
                <div class="capture-actions">
                    <v-btn
                        icon
                        size="x-small"
                        variant="text"
                        v-bind:color="cap.isAttached === true ? 'primary' : undefined"
                        v-bind:title="cap.isAttached === true ? '添付しない' : '添付する'"
                        v-on:click="toggleAttach(cap)"
                    >
                        <v-icon size="16">{{ cap.isAttached === true ? 'mdi-check-circle' : 'mdi-checkbox-blank-circle-outline' }}</v-icon>
                    </v-btn>
                    <v-btn icon size="x-small" variant="text" v-bind:disabled="i === 0" title="上へ" v-on:click="moveUp(i)">
                        <v-icon size="16">mdi-arrow-up-bold</v-icon>
                    </v-btn>
                    <v-btn icon size="x-small" variant="text" v-bind:disabled="i === captures.length - 1" title="下へ" v-on:click="moveDown(i)">
                        <v-icon size="16">mdi-arrow-down-bold</v-icon>
                    </v-btn>
                    <v-btn icon size="x-small" variant="text" title="ダウンロード" v-on:click="download(cap)">
                        <v-icon size="16">mdi-download</v-icon>
                    </v-btn>
                    <v-btn icon size="x-small" variant="text" title="削除" v-on:click="removeCapture(i)">
                        <v-icon size="16">mdi-close</v-icon>
                    </v-btn>
                </div>
            </div>
        </div>

        <v-btn
            size="small"
            variant="outlined"
            prepend-icon="mdi-camera-outline"
            class="mt-1"
            v-bind:disabled="getVideoElement === null || isCapturing === true"
            v-bind:loading="isCapturing"
            v-on:click="capture"
        >
            キャプチャを追加
        </v-btn>

        <v-dialog v-model="isPreviewOpen" v-bind:fullscreen="isMobile === true" max-width="960" scrollable>
            <v-card v-if="previewCapture !== null" class="preview-card">
                <div class="preview-toolbar">
                    <div class="text-caption preview-info">
                        {{ formatCapturedAt(previewCapture.capturedAt) }} ・ {{ previewCapture.programName ?? '番組名なし' }}
                    </div>
                    <v-spacer></v-spacer>
                    <v-btn icon size="small" variant="text" title="閉じる" v-on:click="isPreviewOpen = false">
                        <v-icon>mdi-close</v-icon>
                    </v-btn>
                </div>
                <div class="preview-body">
                    <img v-bind:src="previewCapture.dataUrl" class="preview-image" />
                </div>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import DateUtil from '@/util/DateUtil';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';

/**
 * 撮影したキャプチャ 1 枚分の状態。
 * isAttached: 投稿に添付するかどうか (撮影しただけでは投稿に含まれない)
 * isDownloaded / isPosted: どちらも false のものが 1 枚でもあると視聴画面離脱時に確認を出す
 */
export interface SnsCapture {
    id: string;
    dataUrl: string;
    capturedAt: number;
    programName: string | null;
    isAttached: boolean;
    isDownloaded: boolean;
    isPosted: boolean;
}

/**
 * SNS 投稿パネルのキャプチャ添付。再生中の video 要素から canvas 経由で JPEG を切り出す
 * (Bluesky の blob 上限 2MB に収まるよう、品質を下げて → それでも収まらなければ解像度を縮小して再試行する)
 *
 * キャプチャは撮影しただけでは投稿に添付されない (isAttached で個別に切り替える)。
 * 添付できるのは最大 4 枚までで、撮影自体はそれを超えて保持できる。
 * modelValue には「添付中のキャプチャの dataURL」を表示順 (= 添付順) で流す。
 */
@Component({})
class SnsCaptureAttachment extends Vue {
    @Prop({ required: true })
    public modelValue!: string[];

    // キャプチャ元の video 要素を返す関数。null の場合はキャプチャ不可 (ボタンを無効化する)
    @Prop({ required: false, default: null })
    public getVideoElement!: (() => HTMLVideoElement | null) | null;

    // 撮影時点の番組名 (キャプチャに焼き込んでファイル名・一覧表示に使う)
    @Prop({ required: false, default: null })
    public programName!: string | null;

    public readonly maxAttached: number = 4;
    public isCapturing: boolean = false;
    public captures: SnsCapture[] = [];
    public previewCapture: SnsCapture | null = null;

    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private idSeq: number = 0;

    // Bluesky の画像 blob 上限 (2MB)。base64 のオーバーヘッド分を差し引いて少し余裕を持たせる
    private static readonly TARGET_MAX_BYTES = 1900000;
    // toDataURL に渡す品質を高い順に試す
    private static readonly QUALITY_STEPS = [0.92, 0.8, 0.65, 0.5, 0.35];
    // 品質を下げても収まらない場合に解像度を落として再試行する回数
    private static readonly MAX_SCALE_ATTEMPTS = 4;
    private static readonly SCALE_FACTOR = 0.75;

    /**
     * 端末幅がスマホ相当かどうか (拡大プレビューを全画面にするかの判定に使う)
     */
    public get isMobile(): boolean {
        return this.$vuetify.display.smAndDown === true;
    }

    public get attachedCount(): number {
        return this.captures.filter(c => c.isAttached === true).length;
    }

    public get isPreviewOpen(): boolean {
        return this.previewCapture !== null;
    }

    public set isPreviewOpen(value: boolean) {
        if (value === false) {
            this.previewCapture = null;
        }
    }

    public mounted(): void {
        window.addEventListener('beforeunload', this.onBeforeUnload);
    }

    public beforeUnmount(): void {
        window.removeEventListener('beforeunload', this.onBeforeUnload);
    }

    /**
     * ブラウザのタブを閉じる・再読み込みするときのハンドラ。
     * ダウンロードも投稿もしていないキャプチャが残っていれば標準の確認ダイアログを出す
     */
    public onBeforeUnload(event: BeforeUnloadEvent): void {
        if (this.hasUnsavedCaptures() === true) {
            event.preventDefault();
            event.returnValue = '';
        }
    }

    /**
     * ダウンロードも投稿もしていないキャプチャが 1 枚でもあるか
     * @return boolean
     */
    public hasUnsavedCaptures(): boolean {
        return this.captures.some(c => c.isDownloaded === false && c.isPosted === false);
    }

    /**
     * 投稿成功時に親から呼ばれる。現在添付中のキャプチャを投稿済みにし、添付は解除する
     * (同じ画像を誤って再投稿しないようにするため)
     */
    public markAttachedAsPosted(): void {
        let changed = false;
        for (const cap of this.captures) {
            if (cap.isAttached === true) {
                cap.isAttached = false;
                cap.isPosted = true;
                changed = true;
            }
        }
        if (changed === true) {
            this.emitAttached();
        }
    }

    /**
     * 再生中の video からキャプチャを 1 枚撮影する。添付枠 (4 枚) に空きがあれば自動で添付する
     */
    public async capture(): Promise<void> {
        if (this.isCapturing === true) return;

        const video = this.getVideoElement?.() ?? null;
        if (video === null || video.videoWidth === 0 || video.videoHeight === 0) {
            this.snackbarState.open({ color: 'error', text: 'キャプチャできる映像がありません' });

            return;
        }

        this.isCapturing = true;
        try {
            const dataUrl = SnsCaptureAttachment.captureToDataUrl(video);
            const canAttach = this.attachedCount < this.maxAttached;
            this.captures.push({
                id: this.generateId(),
                dataUrl,
                capturedAt: Date.now(),
                programName: this.programName,
                isAttached: canAttach,
                isDownloaded: false,
                isPosted: false,
            });
            if (canAttach === false) {
                this.snackbarState.open({
                    color: 'normal',
                    text: `添付できるキャプチャは最大 ${this.maxAttached} 枚までのため、今回のキャプチャは添付せずに保存しました`,
                });
            }
            this.emitAttached();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: 'キャプチャに失敗しました (この映像は再生方式の都合で画像として取得できない可能性があります)',
            });
        }
        this.isCapturing = false;
    }

    /**
     * 添付する / しないを切り替える。添付済みが 4 枚のときに新たに添付しようとした場合は理由を出して弾く
     * @param cap: SnsCapture
     */
    public toggleAttach(cap: SnsCapture): void {
        if (cap.isAttached === false && this.attachedCount >= this.maxAttached) {
            this.snackbarState.open({ color: 'error', text: `添付できるキャプチャは最大 ${this.maxAttached} 枚までです` });

            return;
        }
        cap.isAttached = !cap.isAttached;
        this.emitAttached();
    }

    public moveUp(index: number): void {
        if (index <= 0) return;
        this.swap(index, index - 1);
    }

    public moveDown(index: number): void {
        if (index >= this.captures.length - 1) return;
        this.swap(index, index + 1);
    }

    private swap(a: number, b: number): void {
        const tmp = this.captures[a];
        this.captures[a] = this.captures[b];
        this.captures[b] = tmp;
        this.emitAttached();
    }

    public removeCapture(index: number): void {
        const removed = this.captures[index];
        this.captures.splice(index, 1);
        if (this.previewCapture !== null && removed !== undefined && this.previewCapture.id === removed.id) {
            this.previewCapture = null;
        }
        this.emitAttached();
    }

    public openPreview(cap: SnsCapture): void {
        this.previewCapture = cap;
    }

    /**
     * `<a download>` を使い、キャプチャを画像として手動保存する。
     * ファイル名は `<番組名>_<YYYYMMDD-HHmmss>.jpg` (使えない文字は `_` に置換)
     * @param cap: SnsCapture
     */
    public download(cap: SnsCapture): void {
        const a = document.createElement('a');
        a.href = cap.dataUrl;
        a.download = SnsCaptureAttachment.buildFileName(cap);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        cap.isDownloaded = true;
    }

    public formatCapturedAt(capturedAt: number): string {
        return DateUtil.format(new Date(capturedAt), 'yyyy/MM/dd hh:mm:ss');
    }

    /**
     * 現在添付中のキャプチャを表示順のまま dataURL 配列にして親へ通知する
     */
    private emitAttached(): void {
        this.$emit(
            'update:modelValue',
            this.captures.filter(c => c.isAttached === true).map(c => c.dataUrl),
        );
    }

    private generateId(): string {
        this.idSeq += 1;

        return `${Date.now()}-${this.idSeq}`;
    }

    /**
     * ダウンロード用のファイル名を組み立てる
     * @param cap: SnsCapture
     * @return string
     */
    private static buildFileName(cap: SnsCapture): string {
        const program = SnsCaptureAttachment.sanitizeFileNamePart(cap.programName ?? '番組名なし');
        const time = DateUtil.format(new Date(cap.capturedAt), 'yyyyMMdd-hhmmss');

        return `${program}_${time}.jpg`;
    }

    /**
     * ファイル名に使えない文字を `_` へ置換する
     * @param name: string
     * @return string
     */
    private static sanitizeFileNamePart(name: string): string {
        // eslint-disable-next-line no-control-regex
        return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
    }

    /**
     * video 要素から JPEG の data URL を切り出す。2MB を超える場合は品質 → 解像度の順に落として収める
     * @param video: HTMLVideoElement
     * @return string data URL (image/jpeg)
     */
    private static captureToDataUrl(video: HTMLVideoElement): string {
        let width = video.videoWidth;
        let height = video.videoHeight;

        for (let scaleAttempt = 0; scaleAttempt < SnsCaptureAttachment.MAX_SCALE_ATTEMPTS; scaleAttempt++) {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width));
            canvas.height = Math.max(1, Math.round(height));
            const ctx = canvas.getContext('2d');
            if (ctx === null) {
                throw new Error('CanvasContextUnavailable');
            }
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            for (const quality of SnsCaptureAttachment.QUALITY_STEPS) {
                // CORS 汚染された video の場合、ここで SecurityError が投げられる (呼び出し元で catch する)
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                if (SnsCaptureAttachment.estimateByteSize(dataUrl) <= SnsCaptureAttachment.TARGET_MAX_BYTES) {
                    return dataUrl;
                }
            }

            width *= SnsCaptureAttachment.SCALE_FACTOR;
            height *= SnsCaptureAttachment.SCALE_FACTOR;
        }

        throw new Error('CaptureTooLarge');
    }

    /**
     * data URL の概算バイト数を求める (base64 は 4 文字で 3 バイトを表す)
     * @param dataUrl: string
     * @return number
     */
    private static estimateByteSize(dataUrl: string): number {
        const commaIndex = dataUrl.indexOf(',');
        const base64Length = commaIndex === -1 ? dataUrl.length : dataUrl.length - commaIndex - 1;

        return Math.floor(base64Length * 0.75);
    }
}

export default toNative(SnsCaptureAttachment);
</script>

<style lang="sass" scoped>
.sns-capture-attachment
    .captures-header
        color: var(--watch-fg-dim)
        margin-bottom: 4px

    .capture-list
        display: flex
        flex-direction: column
        gap: 6px
        margin-bottom: 8px

    .capture-item
        border: 1px solid var(--watch-border-subtle)
        border-radius: 4px
        padding: 6px
        transition: border-color 0.15s ease

        &.is-attached
            border-color: rgb(var(--v-theme-primary))

        .capture-main
            display: flex
            align-items: center
            gap: 8px

        .capture-thumb
            flex: 0 0 auto
            width: 64px
            height: 36px
            border-radius: 4px
            overflow: hidden
            background: rgba(0, 0, 0, 0.3)
            cursor: pointer

            img
                width: 100%
                height: 100%
                object-fit: cover
                display: block

        .capture-meta
            flex: 1 1 auto
            min-width: 0

            .capture-time
                color: var(--watch-fg-dim)

            .capture-program
                white-space: normal
                word-break: break-all

            .capture-flags
                display: flex
                gap: 4px
                margin-top: 2px

        .capture-actions
            display: flex
            flex-wrap: wrap
            gap: 2px
            margin-top: 4px

// 拡大プレビューの v-dialog は中身が document.body 直下へテレポートされるため、
// .sns-capture-attachment の子孫セレクタでは当たらない (ネストさせない)
.preview-card
    display: flex
    flex-direction: column
    max-height: inherit

.preview-toolbar
    display: flex
    align-items: center
    flex: 0 0 auto
    padding: 6px 6px 6px 12px

    .preview-info
        flex: 1 1 auto
        min-width: 0
        overflow: hidden
        text-overflow: ellipsis
        white-space: nowrap

.preview-body
    flex: 1 1 auto
    min-height: 0
    display: flex
    align-items: center
    justify-content: center
    padding: 0 12px 12px
    overflow: auto

    .preview-image
        max-width: 100%
        max-height: 80vh
        object-fit: contain
</style>
