<template>
    <div class="sns-post-panel">
        <button class="header" type="button" v-bind:aria-expanded="isCollapsed === false" v-on:click="isCollapsed = !isCollapsed">
            <v-icon size="small" class="mr-1">mdi-send-outline</v-icon>
            <div class="header-title">SNS投稿</div>
            <v-spacer></v-spacer>
            <v-icon size="small">{{ isCollapsed === true ? 'mdi-chevron-down' : 'mdi-chevron-up' }}</v-icon>
        </button>

        <div v-show="isCollapsed === false" class="body">
            <template v-if="hasAccounts === false">
                <div class="text-body-2 empty">
                    連携済みの SNS アカウントがありません。<br />
                    設定 > SNS 投稿 から連携してください。
                </div>
                <v-btn size="small" variant="outlined" class="mt-2" to="/settings/sns">SNS 連携アカウントを管理</v-btn>
            </template>
            <template v-else>
                <div class="tab-row">
                    <v-btn-toggle
                        v-if="isSplitView === false"
                        v-model="activeTab"
                        mandatory
                        density="compact"
                        variant="outlined"
                        divided
                        class="tab-toggle"
                    >
                        <v-btn value="post" size="small">投稿</v-btn>
                        <v-btn value="timeline" size="small">タイムライン</v-btn>
                    </v-btn-toggle>
                    <SnsAccountSelector
                        class="header-accounts"
                        v-bind:accounts="accounts"
                        v-bind:compact="true"
                        v-model="selectedAccountIds"
                    ></SnsAccountSelector>
                    <SnsMisskeyOptions
                        v-if="hasMisskeySelected === true"
                        class="header-misskey-options"
                        v-bind:accounts="selectedMisskeyAccounts"
                        v-model="misskeyOption"
                    ></SnsMisskeyOptions>
                    <v-spacer v-if="isSplitView === true"></v-spacer>
                    <!-- 狭い端末では常にタブ切替になり設定を切り替えても見た目が変わらないため、混乱を避けてボタン自体を出さない -->
                    <v-btn
                        v-if="isMobile === false"
                        icon
                        size="small"
                        variant="text"
                        density="compact"
                        v-bind:title="isSplitView === true ? 'タブ切り替え表示にする' : '投稿とタイムラインを同時表示する'"
                        v-on:click="toggleSplitView"
                    >
                        <v-icon size="small">{{ isSplitView === true ? 'mdi-tab' : 'mdi-view-split-horizontal' }}</v-icon>
                    </v-btn>
                </div>

                <!--
                    投稿フォームはタブ切替中でも常にマウントし続ける (v-show)。
                    SnsCaptureAttachment は撮影済みキャプチャを自身の内部状態で保持しているため、
                    v-if で unmount すると「投稿画面を離れていないのにタブを切り替えただけ」で
                    未添付のキャプチャが消えてしまう
                -->
                <div ref="splitContainer" class="content-area" v-bind:class="{ 'is-split': isSplitView === true }">
                    <div
                        class="pane pane-post"
                        v-show="isSplitView === true || activeTab === 'post'"
                        v-bind:style="isSplitView === true ? { flexBasis: `${splitRatioPercent}%` } : undefined"
                    >
                        <div class="tab-content post-tab">
                            <div class="section">
                                <v-textarea
                                    ref="bodyTextarea"
                                    v-model="bodyText"
                                    label="本文"
                                    rows="3"
                                    auto-grow
                                    v-bind:density="isMobile === true ? 'compact' : 'comfortable'"
                                    hide-details
                                    v-bind:counter="blueskyMaxLength"
                                ></v-textarea>

                                <div v-if="showPreview === true" class="compose-preview">
                                    <div class="preview-label text-caption">プレビュー</div>
                                    <MfmText v-bind:nodes="previewNodes" v-bind:emojiMap="emojiMap"></MfmText>
                                </div>

                                <div v-if="hasMisskeySelected === true" class="decoration-row">
                                    <v-menu v-model="isEmojiMenuOpen" v-bind:close-on-content-click="false" location="top">
                                        <template v-slot:activator="{ props }">
                                            <v-btn size="small" variant="outlined" v-bind="props" prepend-icon="mdi-emoticon-outline">絵文字</v-btn>
                                        </template>
                                        <v-card class="menu-card composer-menu-card">
                                            <v-card-text class="menu-card-body">
                                                <SnsEmojiPicker v-bind:emojis="composerEmojis" v-on:select="onInsertEmoji"></SnsEmojiPicker>
                                            </v-card-text>
                                        </v-card>
                                    </v-menu>
                                    <v-menu v-model="isDecorationMenuOpen" v-bind:close-on-content-click="false" location="top">
                                        <template v-slot:activator="{ props }">
                                            <v-btn size="small" variant="outlined" v-bind="props" prepend-icon="mdi-format-color-text">装飾</v-btn>
                                        </template>
                                        <v-card class="menu-card composer-menu-card">
                                            <v-card-text class="menu-card-body">
                                                <SnsMfmPicker v-on:select="onInsertDecoration"></SnsMfmPicker>
                                            </v-card-text>
                                        </v-card>
                                    </v-menu>
                                </div>
                            </div>

                            <div class="section">
                                <div class="section-label text-caption">ハッシュタグ</div>
                                <SnsHashtagField v-model="hashtags"></SnsHashtagField>
                            </div>

                            <div class="section">
                                <SnsCaptureAttachment
                                    ref="captureAttachment"
                                    v-model="images"
                                    v-bind:programName="programInfo === null ? null : programInfo.name"
                                ></SnsCaptureAttachment>
                            </div>

                            <v-alert v-if="lastResults.length > 0" v-bind:type="allLastResultsSucceeded === true ? 'success' : 'warning'" density="compact" class="mt-2">
                                <div v-for="r in lastResults" v-bind:key="r.accountId" class="text-caption">
                                    {{ accountLabel(r.accountId) }}: {{ r.isSuccess === true ? '投稿しました' : `失敗 (${r.detail ?? '不明なエラー'})` }}
                                </div>
                            </v-alert>

                            <div class="post-actions">
                                <v-btn
                                    block
                                    color="primary"
                                    variant="flat"
                                    v-bind:loading="isPosting"
                                    v-bind:disabled="canPost === false"
                                    v-on:click="submit"
                                >
                                    投稿する
                                </v-btn>
                            </div>
                        </div>
                    </div>

                    <div
                        v-if="isSplitView === true"
                        class="split-divider"
                        v-on:pointerdown="onDividerPointerDown"
                        v-on:pointermove="onDividerPointerMove"
                        v-on:pointerup="onDividerPointerUp"
                        v-on:pointercancel="onDividerPointerUp"
                    >
                        <div class="split-divider-handle"></div>
                    </div>

                    <div class="pane pane-timeline" v-show="isSplitView === true || activeTab === 'timeline'">
                        <!--
                            タイムライン (WebSocket 購読 / ポーリング) は表示されているときだけマウントする。
                            タブ切替で非表示になったら必ず止める (SnsTimelinePanel.unmounted() が行う)
                        -->
                        <div v-if="isSplitView === true || activeTab === 'timeline'" class="tab-content timeline-tab">
                            <SnsTimelinePanel v-bind:accounts="accounts"></SnsTimelinePanel>
                        </div>
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import ISnsPostState from '@/model/state/sns/ISnsPostState';
import ISnsTimelineState from '@/model/state/sns/ISnsTimelineState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import { MfmNode, parseMfm } from '@/util/MfmRenderUtil';
import ProgramHashtagUtil from '@/util/ProgramHashtagUtil';
import type { ComponentPublicInstance } from 'vue';
import type { ScreenshotRequest } from '@/components/video/BaseVideo';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';
import MfmText from './MfmText.vue';
import SnsAccountSelector from './SnsAccountSelector.vue';
import SnsCaptureAttachment from './SnsCaptureAttachment.vue';
import SnsEmojiPicker from './SnsEmojiPicker.vue';
import SnsHashtagField from './SnsHashtagField.vue';
import SnsMfmPicker, { MfmDecorationDef } from './SnsMfmPicker.vue';
import SnsMisskeyOptions, { SnsMisskeyOptionValue } from './SnsMisskeyOptions.vue';
import SnsTimelinePanel from './SnsTimelinePanel.vue';
import * as apid from '../../../../../api';

/**
 * SnsPostPanel が必要とする番組情報の最小形。
 * ライブ視聴 (`DsiplayWatchInfo`)・録画視聴 (`DsiplayWatchInfo`) のどちらの型もこの形を満たす
 */
export interface SnsPostProgramInfo {
    channelName: string;
    name: string;
    description?: string;
    extended?: string;
}

@Component({
    components: {
        SnsAccountSelector,
        SnsHashtagField,
        SnsCaptureAttachment,
        SnsMisskeyOptions,
        SnsEmojiPicker,
        SnsMfmPicker,
        SnsTimelinePanel,
        MfmText,
    },
})
class SnsPostPanel extends Vue {
    // Bluesky の 1 投稿あたりの文字数上限 (300 grapheme。ここでは目安のカウンタ表示にのみ使う)
    public readonly blueskyMaxLength = 300;

    @Prop({ required: false, default: null })
    public programInfo!: SnsPostProgramInfo | null;

    // ライブ視聴かどうか (true の場合のみ「チャンネル切替時に旧局タグを取り除く」処理を行う)
    @Prop({ required: false, default: false })
    public isLive!: boolean;

    public isCollapsed: boolean = false;
    // サブタブ (投稿 / タイムライン)
    public activeTab: 'post' | 'timeline' = 'post';
    public bodyText: string = '';
    public hashtags: string[] = [];
    public images: string[] = [];
    public selectedAccountIds: apid.SnsAccountId[] = [];
    public isPosting: boolean = false;
    public lastResults: apid.SnsPostAccountResult[] = [];
    public misskeyOption: SnsMisskeyOptionValue = {
        visibility: 'public',
        localOnly: false,
        channelId: null,
        channelName: null,
        cw: '',
    };

    // 絵文字ピッカー・MFM 装飾ピッカーの開閉状態
    public isEmojiMenuOpen: boolean = false;
    public isDecorationMenuOpen: boolean = false;
    // 絵文字ピッカー・本文プレビューの両方に渡す Misskey カスタム絵文字一覧
    // (先頭に選択されている Misskey アカウントのもの。取得箇所を一本化し二重に走らせない)
    public composerEmojis: apid.SnsMisskeyEmoji[] = [];

    // 分割表示のドラッグ中かどうか (ドラッグ量の計算に使う)
    private isDraggingDivider: boolean = false;
    private dividerStartY: number = 0;
    private dividerStartRatio: number = 0;
    // 分割位置の可動域 (投稿フォーム側の高さ比率)
    private static readonly SPLIT_MIN_RATIO = 0.2;
    private static readonly SPLIT_MAX_RATIO = 0.8;

    private snsPostState: ISnsPostState = container.get<ISnsPostState>('ISnsPostState');
    private snsTimelineState: ISnsTimelineState = container.get<ISnsTimelineState>('ISnsTimelineState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private settingStorageModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');

    // 直前に合成したハッシュタグの基準になった番組の識別キー (同じ番組では二重に自動合成しない)
    private lastComposedProgramKey: string | null = null;
    private lastChannelName: string | null = null;
    // 直近に misskeyOption の既定値を入れ直した際の、選択中 Misskey アカウント id の組み合わせキー
    private lastMisskeyAccountsKey: string | null = null;
    // composerEmojis を取得済みのアカウント id (同じアカウントでの再オープンでは取得し直さない。
    // 取得自体は ISnsTimelineState 側でもキャッシュされるが、ここでは無駄な await 自体を避ける)
    private composerEmojisAccountId: apid.SnsAccountId | null = null;
    // 取得中のアカウント id (アカウント選択変更とプレビュー表示・絵文字ピッカーの起動が
    // ほぼ同時に走っても二重に fetch しないためのガード)
    private composerEmojisFetchingAccountId: apid.SnsAccountId | null = null;

    public get accounts(): apid.SnsAccountItem[] {
        return this.snsPostState.getAccounts();
    }

    public get hasAccounts(): boolean {
        return this.accounts.length > 0;
    }

    public get selectedMisskeyAccounts(): apid.SnsAccountItem[] {
        return this.accounts.filter(a => a.provider === 'misskey' && this.selectedAccountIds.includes(a.id));
    }

    public get hasMisskeySelected(): boolean {
        return this.selectedMisskeyAccounts.length > 0;
    }

    public get allLastResultsSucceeded(): boolean {
        return this.lastResults.length > 0 && this.lastResults.every(r => r.isSuccess === true);
    }

    public get canPost(): boolean {
        if (this.isPosting === true) return false;
        if (this.selectedAccountIds.length === 0) return false;

        return this.bodyText.trim() !== '' || this.images.length > 0;
    }

    /**
     * 狭い端末では常にタブ切替 (同時表示にすると両方が使えなくなるため)。
     * それ以外では設定 (`snsUseSplitPanelView`) に従う
     */
    public get isSplitView(): boolean {
        return this.isMobile === false && this.settingStorageModel.tmp.snsUseSplitPanelView === true;
    }

    public get isMobile(): boolean {
        return this.$vuetify.display.smAndDown === true;
    }

    /**
     * 「投稿とタイムラインを同時表示する (分割)」/「タブ切替」を切り替える。
     * 設定画面まで行かせず、パネル上のボタンから直接切り替えられるようにする。
     * localStorage への保存もその場で行う (Settings.vue の未保存トラッキングとは別経路)
     */
    public toggleSplitView(): void {
        this.settingStorageModel.tmp.snsUseSplitPanelView = !this.settingStorageModel.tmp.snsUseSplitPanelView;
        this.settingStorageModel.save();
    }

    // 分割表示時の投稿フォーム側の高さ比率 (%)。ドラッグ中も含め常に設定値をそのまま描画に使う
    public get splitRatioPercent(): number {
        return this.settingStorageModel.tmp.snsSplitPanelRatio * 100;
    }

    // 本文プレビューの表示要否 (設定 ON かつ本文が空でないとき)
    public get showPreview(): boolean {
        return this.settingStorageModel.tmp.snsEnableComposePreview === true && this.bodyText.trim() !== '';
    }

    public get previewNodes(): MfmNode[] {
        return parseMfm(this.bodyText);
    }

    // 本文プレビュー・絵文字ピッカーで共用するカスタム絵文字名 -> 画像 URL のマップ
    public get emojiMap(): Map<string, string> {
        const map = new Map<string, string>();
        for (const e of this.composerEmojis) {
            map.set(e.name, e.url);
        }

        return map;
    }

    public accountLabel(accountId: apid.SnsAccountId): string {
        return this.accounts.find(a => a.id === accountId)?.displayName ?? `#${accountId}`;
    }

    /**
     * ダウンロードも投稿もしていないキャプチャが残っているか。
     * 視聴画面の離脱確認 (beforeRouteLeave) から呼ばれる
     * @return boolean
     */
    public hasUnsavedCaptures(): boolean {
        return (this.$refs.captureAttachment as InstanceType<typeof SnsCaptureAttachment> | undefined)?.hasUnsavedCaptures() ?? false;
    }

    /**
     * DPlayer のカメラボタンから届いた要求を SNS 添付として受け取る。
     * 同期的に claim して、DPlayer 標準の即時ダウンロードを止める
     * @param request DPlayer キャプチャ要求
     */
    public onScreenshotRequest(request: ScreenshotRequest): void {
        const attachment = this.$refs.captureAttachment as InstanceType<typeof SnsCaptureAttachment> | undefined;
        if (typeof attachment === 'undefined') return;

        request.claim();
        void attachment.capture(request.video);
    }

    public async created(): Promise<void> {
        // 前回選択していたアカウントを復元する (存在しなくなったものは除く)
        this.selectedAccountIds = [...this.settingStorageModel.getSavedValue().snsLastSelectedAccountIds];

        try {
            await this.snsPostState.fetchAccounts();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'SNS 連携アカウントの取得に失敗しました' });
        }

        // 存在しないアカウント ID を選択状態から除く
        const accountIds = new Set(this.accounts.map(a => a.id));
        this.selectedAccountIds = this.selectedAccountIds.filter(id => accountIds.has(id));
        // 保存済みの選択が 1 つも残らなかった場合は全アカウントを既定で選択する
        if (this.selectedAccountIds.length === 0 && this.accounts.length > 0) {
            this.selectedAccountIds = this.accounts.map(a => a.id);
        }

        // パネルが開かれたタイミングでもハッシュタグを合成する
        this.composeHashtagsForCurrentProgram(true);
    }

    @Watch('selectedAccountIds', { deep: true })
    public onSelectedAccountIdsChanged(): void {
        this.settingStorageModel.tmp.snsLastSelectedAccountIds = [...this.selectedAccountIds];
        this.settingStorageModel.save();
    }

    /**
     * 選択中の Misskey アカウントの組み合わせが変わったときだけ misskeyOption を既定値へ入れ直す。
     * (無関係な他アカウントの選択変更では、ユーザーが編集中のオプションを消さない)
     * 複数アカウント選択時は先頭のアカウントの既定値を採用し、チャンネルは選べないため null にする
     */
    @Watch('selectedAccountIds', { deep: true })
    public onSelectedAccountIdsChangedForMisskeyOption(): void {
        const misskeyAccounts = this.selectedMisskeyAccounts;
        const key = misskeyAccounts
            .map(a => a.id)
            .sort((a, b) => a - b)
            .join(',');
        if (key === this.lastMisskeyAccountsKey) return;
        this.lastMisskeyAccountsKey = key;

        // 選択中の Misskey アカウントの組み合わせが変わったら、カスタム絵文字一覧を取得し直す
        this.composerEmojis = [];
        this.composerEmojisAccountId = null;
        void this.fetchComposerEmojisIfNeeded();

        if (misskeyAccounts.length === 0) return;

        const base = misskeyAccounts[0];
        this.misskeyOption = {
            visibility: base.defaultVisibility ?? 'public',
            localOnly: base.isDefaultLocalOnly,
            channelId: misskeyAccounts.length === 1 ? base.defaultChannelId : null,
            channelName: misskeyAccounts.length === 1 ? base.defaultChannelName : null,
            cw: '',
        };
    }

    @Watch('programInfo', { deep: true })
    public onProgramInfoChanged(newValue: SnsPostProgramInfo | null, oldValue: SnsPostProgramInfo | null): void {
        // ライブでチャンネルが切り替わったら、旧チャンネルの局タグだけをハッシュタグから取り除く
        if (this.isLive === true && oldValue !== null && newValue !== null && oldValue.channelName !== newValue.channelName) {
            const oldChannelTag = ProgramHashtagUtil.getChannelHashtag(oldValue.channelName);
            if (oldChannelTag !== null) {
                const key = oldChannelTag.toLowerCase();
                this.hashtags = this.hashtags.filter(t => t.toLowerCase() !== key);
            }
        }

        this.composeHashtagsForCurrentProgram(false);
    }

    /**
     * 現在の番組情報からハッシュタグを合成し、ハッシュタグ入力欄へ反映する。
     * 同じ番組 (チャンネル名 + 番組名) に対しては二重に合成しない (ユーザーが手で消したタグを足し戻さないため)
     * @param force: true の場合、番組キーが同じでも合成し直す (パネルを開いた直後専用)
     */
    private composeHashtagsForCurrentProgram(force: boolean): void {
        if (this.programInfo === null) return;

        const key = `${this.programInfo.channelName}::${this.programInfo.name}`;
        if (force === false && key === this.lastComposedProgramKey) return;
        this.lastComposedProgramKey = key;
        this.lastChannelName = this.programInfo.channelName;

        const settings = this.settingStorageModel.tmp;
        const channelTag = settings.snsAutoAddChannelHashtag === true ? ProgramHashtagUtil.getChannelHashtag(this.programInfo.channelName) : null;
        const programTags =
            settings.snsAutoAddProgramHashtag === true ? ProgramHashtagUtil.extractProgramHashtags(this.programInfo.description, this.programInfo.extended) : [];

        const base = settings.snsResetHashtagOnProgramSwitch === true ? [] : this.hashtags;
        this.hashtags = ProgramHashtagUtil.composeHashtags(base, channelTag, programTags, {
            includeChannelHashtag: settings.snsAutoAddChannelHashtag,
            includeProgramHashtags: settings.snsAutoAddProgramHashtag,
        });
    }

    /**
     * misskeyOption (パネル上の編集状態) から実際に送る apid.SnsPostMisskeyOption を組み立てる。
     * チャンネルは複数 Misskey アカウント選択時は選べないため送らず (各アカウントの既定値にフォールバックさせる)、
     * CW は空文字なら送らない
     * @return apid.SnsPostMisskeyOption
     */
    private buildMisskeyPostOption(): apid.SnsPostMisskeyOption {
        const option: apid.SnsPostMisskeyOption = {
            visibility: this.misskeyOption.visibility,
            localOnly: this.misskeyOption.localOnly,
        };

        if (this.selectedMisskeyAccounts.length === 1) {
            option.channelId = this.misskeyOption.channelId;
        }

        const cw = this.misskeyOption.cw.trim();
        if (cw !== '') {
            option.cw = cw;
        }

        return option;
    }

    /**
     * 絵文字ピッカーを開いたタイミングでも、先頭に選択されている Misskey アカウントの
     * カスタム絵文字一覧を取得する (通常はアカウント選択時点で先に取得済みのため、ここでは
     * まだ取得できていない場合の保険)
     */
    @Watch('isEmojiMenuOpen')
    public async onEmojiMenuOpenChanged(isOpen: boolean): Promise<void> {
        if (isOpen === false) return;

        await this.fetchComposerEmojisIfNeeded();
    }

    /**
     * 選択中の先頭 Misskey アカウントのカスタム絵文字一覧を取得する。
     * 絵文字ピッカーと本文プレビューの両方がこの一覧 (`composerEmojis`) を使い回すため、
     * 取得箇所はここ 1 箇所にまとめる (`ISnsTimelineState` 側にもアカウント単位のキャッシュがあるため
     * 呼び出し自体は安価だが、無駄な await と同時多重呼び出しはここで避ける)
     */
    private async fetchComposerEmojisIfNeeded(): Promise<void> {
        const account = this.selectedMisskeyAccounts[0];
        if (typeof account === 'undefined') return;
        if (this.composerEmojisAccountId === account.id) return;
        if (this.composerEmojisFetchingAccountId === account.id) return;

        this.composerEmojisFetchingAccountId = account.id;
        try {
            this.composerEmojis = await this.snsTimelineState.getMisskeyEmojis(account.id);
            this.composerEmojisAccountId = account.id;
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'カスタム絵文字一覧の取得に失敗しました' });
        } finally {
            if (this.composerEmojisFetchingAccountId === account.id) {
                this.composerEmojisFetchingAccountId = null;
            }
        }
    }

    /**
     * 分割表示のドラッグ開始。以後の pointermove/pointerup はこの要素へ確実に届くよう
     * pointer capture を取る (カーソルが divider の外へ出ても操作を続けられる)
     * @param event: PointerEvent
     */
    public onDividerPointerDown(event: PointerEvent): void {
        this.isDraggingDivider = true;
        this.dividerStartY = event.clientY;
        this.dividerStartRatio = this.settingStorageModel.tmp.snsSplitPanelRatio;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }

    /**
     * 分割表示のドラッグ中。移動量をコンテナの高さに対する比率に変換して即座に反映する
     * (localStorage への保存はドラッグ終了時にまとめて行う)
     * @param event: PointerEvent
     */
    public onDividerPointerMove(event: PointerEvent): void {
        if (this.isDraggingDivider === false) return;

        const container = this.$refs.splitContainer as HTMLElement | undefined;
        const containerHeight = container?.getBoundingClientRect().height ?? 0;
        if (containerHeight <= 0) return;

        const deltaRatio = (event.clientY - this.dividerStartY) / containerHeight;
        const nextRatio = Math.min(
            SnsPostPanel.SPLIT_MAX_RATIO,
            Math.max(SnsPostPanel.SPLIT_MIN_RATIO, this.dividerStartRatio + deltaRatio),
        );
        this.settingStorageModel.tmp.snsSplitPanelRatio = nextRatio;
    }

    /**
     * 分割表示のドラッグ終了。ここで初めて localStorage へ保存する
     */
    public onDividerPointerUp(): void {
        if (this.isDraggingDivider === false) return;
        this.isDraggingDivider = false;
        this.settingStorageModel.save();
    }

    /**
     * 絵文字ピッカーで選んだ絵文字をカーソル位置へ挿入する
     * @param emoji: apid.SnsMisskeyEmoji
     */
    public onInsertEmoji(emoji: apid.SnsMisskeyEmoji): void {
        this.insertTextAtCursor(`:${emoji.name}:`);
        this.isEmojiMenuOpen = false;
    }

    /**
     * MFM 装飾ピッカーで選んだ装飾を本文へ適用する。
     * 文字を選択していればその範囲を prefix/suffix で包み、選択が無ければ記法を挿入して
     * placeholder 部分を選択状態にする (続けてそのまま書き換えられるように)
     * @param decoration: MfmDecorationDef
     */
    public onInsertDecoration(decoration: MfmDecorationDef): void {
        const textarea = this.getBodyTextareaElement();
        const start = textarea?.selectionStart ?? this.bodyText.length;
        const end = textarea?.selectionEnd ?? this.bodyText.length;
        const selectedText = this.bodyText.slice(start, end);
        const hasSelection = selectedText !== '';
        const inner = hasSelection === true ? selectedText : decoration.placeholder;
        const wrapped = `${decoration.prefix}${inner}${decoration.suffix}`;

        this.bodyText = this.bodyText.slice(0, start) + wrapped + this.bodyText.slice(end);

        if (hasSelection === true) {
            const cursor = start + wrapped.length;
            void this.focusBodyTextareaAt(cursor, cursor);
        } else {
            const innerStart = start + decoration.prefix.length;
            void this.focusBodyTextareaAt(innerStart, innerStart + decoration.placeholder.length);
        }

        this.isDecorationMenuOpen = false;
    }

    /**
     * 本文の textarea のカーソル位置 (選択があれば選択範囲) をテキストで置き換え、挿入直後へカーソルを移す
     * @param text: string
     */
    private insertTextAtCursor(text: string): void {
        const textarea = this.getBodyTextareaElement();
        const start = textarea?.selectionStart ?? this.bodyText.length;
        const end = textarea?.selectionEnd ?? this.bodyText.length;

        this.bodyText = this.bodyText.slice(0, start) + text + this.bodyText.slice(end);

        const cursor = start + text.length;
        void this.focusBodyTextareaAt(cursor, cursor);
    }

    /**
     * v-textarea (`bodyTextarea` ref) が内部で持つ実体の `<textarea>` 要素を取得する
     * @return HTMLTextAreaElement | null
     */
    private getBodyTextareaElement(): HTMLTextAreaElement | null {
        const instance = this.$refs.bodyTextarea as ComponentPublicInstance | undefined;
        if (typeof instance === 'undefined') return null;

        return instance.$el.querySelector('textarea');
    }

    /**
     * 本文の textarea へフォーカスを戻し、指定位置 (または範囲) を選択状態にする。
     * bodyText の書き換えが DOM へ反映されるのを待つ必要があるため nextTick 後に行う
     * @param start: number
     * @param end: number
     */
    private async focusBodyTextareaAt(start: number, end: number): Promise<void> {
        await this.$nextTick();

        const textarea = this.getBodyTextareaElement();
        if (textarea === null) return;

        textarea.focus();
        textarea.setSelectionRange(start, end);
    }

    public async submit(): Promise<void> {
        if (this.canPost === false) return;

        this.isPosting = true;
        this.lastResults = [];
        try {
            const text = ProgramHashtagUtil.applyHashtags(this.bodyText.trim(), this.hashtags, this.settingStorageModel.tmp.snsHashtagPosition);
            const result = await this.snsPostState.post({
                accountIds: this.selectedAccountIds,
                text: text,
                hashtags: this.hashtags,
                images: this.images.length === 0 ? undefined : this.images.map(dataUrl => ({ dataUrl })),
                misskey: this.hasMisskeySelected === true ? this.buildMisskeyPostOption() : undefined,
            });
            this.lastResults = result.results;

            const successCount = result.results.filter(r => r.isSuccess === true).length;
            if (successCount === result.results.length) {
                this.snackbarState.open({ color: 'success', text: `${successCount} 件のアカウントへ投稿しました` });
                // 投稿本文はクリアする (ハッシュタグは同じ番組向けにそのまま残す)。
                // 添付していたキャプチャは削除せず「投稿済み」にする (子コンポーネント側で添付は解除される)
                this.bodyText = '';
                (this.$refs.captureAttachment as InstanceType<typeof SnsCaptureAttachment> | undefined)?.markAttachedAsPosted();
                if (this.settingStorageModel.tmp.snsFoldPanelAfterPost === true) {
                    this.isCollapsed = true;
                }
            } else if (successCount === 0) {
                this.snackbarState.open({ color: 'error', text: '投稿に失敗しました' });
            } else {
                this.snackbarState.open({ color: 'normal', text: `${successCount}/${result.results.length} 件のアカウントへ投稿しました (一部失敗)` });
            }
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '投稿に失敗しました' });
        }
        this.isPosting = false;
    }
}

export default toNative(SnsPostPanel);
</script>

<style lang="sass" scoped>
.sns-post-panel
    display: flex
    flex-direction: column
    height: 100%
    color: var(--watch-fg)

    .header
        width: 100%
        display: flex
        align-items: center
        flex-shrink: 0
        padding: 8px 12px
        color: inherit
        background: transparent
        border: 0
        cursor: pointer
        user-select: none
        border-bottom: 1px solid var(--watch-border-subtle)

        .header-title
            font-size: 0.85rem
            font-weight: bold

    .body
        flex: 1 1 auto
        min-height: 0
        overflow-y: auto
        padding: 12px

    // 狭幅 (スマホ・視聴画面の狭いサイドパネル) では 1 行に収まらないため折り返す。
    // ビューポート幅の @media ではなく flex-wrap で対応しているのは、このパネルの実際の幅は
    // 視聴画面のレイアウト (分割表示・サイドパネル幅) 次第でビューポート幅と一致しないため
    .tab-row
        display: flex
        align-items: center
        flex-wrap: wrap
        gap: 6px
        margin-bottom: 8px

        .tab-toggle
            flex: 1 1 140px
            min-width: 0

        .header-accounts
            flex: 1 1 120px
            min-width: 0
            overflow-x: auto

        .header-misskey-options,
        > .v-btn
            flex: 0 0 auto

    .section
        margin-bottom: 12px

        .section-label
            color: var(--watch-fg-dim)
            margin-bottom: 4px

    .empty
        color: var(--watch-fg-dim)

    .compose-preview
        margin-top: 8px
        padding: 8px
        border-radius: 6px
        background: rgba(128, 128, 128, 0.08)
        font-size: 0.85rem

        .preview-label
            color: var(--watch-fg-dim)
            margin-bottom: 4px

    // タブ切替表示 (既定): pane は v-show の display none/block だけで出し分ける
    .content-area
        display: block

        // 縦分割の同時表示 (広い画面かつ設定 ON のときのみ)
        &.is-split
            display: flex
            flex-direction: column
            height: 100%
            min-height: 0

            .pane-post
                flex: 0 0 auto
                min-height: 72px
                overflow-y: auto
                padding-right: 2px

            .pane-timeline
                flex: 1 1 auto
                min-height: 72px
                display: flex
                flex-direction: column

                .tab-content.timeline-tab
                    flex: 1 1 auto
                    min-height: 0
                    display: flex
                    flex-direction: column

    .split-divider
        flex: 0 0 auto
        display: flex
        align-items: center
        justify-content: center
        height: 16px
        margin: 2px 0
        cursor: row-resize
        touch-action: none

        .split-divider-handle
            width: 48px
            height: 4px
            border-radius: 2px
            background: var(--watch-border-subtle)

        &:hover .split-divider-handle,
        &:active .split-divider-handle
            background: rgb(var(--v-theme-primary))

    .post-actions
        position: sticky
        bottom: -12px
        z-index: 2
        margin: 12px -12px -12px
        padding: 10px 12px 12px
        border-top: 1px solid var(--watch-border-subtle)
        background: rgb(var(--v-theme-surface))

    @media screen and (max-width: 600px)
        // 外側の WatchSidePanel に同じ見出しがあるため、狭い画面では重複をなくして操作領域へ高さを渡す
        .header
            display: none

        .body
            padding: 8px

        .tab-row
            position: sticky
            top: -8px
            z-index: 3
            margin: -8px -8px 8px
            padding: 8px
            border-bottom: 1px solid var(--watch-border-subtle)
            background: rgb(var(--v-theme-surface))

        .tab-toggle
            flex: 1 1 auto

            :deep(.v-btn)
                flex: 1 1 50%

        .section
            margin-bottom: 8px

        .decoration-row
            display: flex
            gap: 6px

            :deep(.v-btn)
                flex: 1 1 0
                min-width: 0

        .post-actions
            bottom: -8px
            margin: 8px -8px -8px
            padding: 8px

// v-menu の中身は document.body 直下へテレポートされるため .sns-post-panel の子孫としてネストさせない。
// v-card の max-width prop はインラインスタイルとなり .menu-card (共通クラス) の
// max-width: calc(100vw - 32px) より強くなってしまうため、希望幅は width で持たせる
.composer-menu-card
    width: 360px
</style>
