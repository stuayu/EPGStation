<template>
    <div class="sns-timeline-panel">
        <div class="tl-controls">
            <div class="top-row">
                <!--
                    狭い端末ではアカウントが 1 つしか無いとき、この行ごと出さない
                    (誰のタイムラインかは投稿タブ側のアカウント選択で分かるため、ここでの表示は冗長)。
                    アカウントが複数あるときは切り替え手段が他に無いため、狭い端末でも出す
                -->
                <v-chip-group
                    v-if="showAccountChipGroup === true"
                    v-model="selectedAccountId"
                    mandatory
                    selected-class="text-primary"
                    class="account-chip-group"
                    v-on:update:model-value="onAccountChanged"
                >
                    <v-chip v-for="a in accounts" v-bind:key="a.id" v-bind:value="a.id" size="small" variant="outlined">
                        <v-avatar start size="18">
                            <v-img v-if="a.avatarUrl !== null" v-bind:src="a.avatarUrl" referrerpolicy="no-referrer"></v-img>
                            <v-icon v-else size="14">{{ a.provider === 'bluesky' ? 'mdi-butterfly-outline' : 'mdi-account-circle' }}</v-icon>
                        </v-avatar>
                        <span class="chip-label">{{ a.displayName }}</span>
                    </v-chip>
                </v-chip-group>

                <!--
                    狭い端末では「タイムライン種別 + チャンネル」の v-select をインライン表示せず、
                    アイコンボタン 1 つ (現在の種別名付き) + メニューへ畳む。
                    アカウント選択の行と合わせても 1 行分の高さで済むようにし、ノート一覧 (.note-list) へ
                    高さを渡す。操作 (種別切替・チャンネル選択) 自体はメニューの中にそのまま残す
                -->
                <v-menu
                    v-if="isMobile === true && selectedAccount !== null && selectedAccount.provider === 'misskey'"
                    v-bind:close-on-content-click="false"
                    location="bottom end"
                >
                    <template v-slot:activator="{ props }">
                        <v-btn size="small" variant="outlined" density="compact" v-bind="props" class="type-filter-btn" v-bind:title="`タイムライン: ${timelineTypeLabel}`">
                            <v-icon size="16" class="mr-1">mdi-filter-variant</v-icon>
                            <span class="text-caption">{{ timelineTypeLabel }}</span>
                        </v-btn>
                    </template>
                    <v-card class="menu-card timeline-menu-card">
                        <v-card-text class="menu-card-body">
                            <v-select
                                v-model="timelineType"
                                v-bind:items="typeItems"
                                label="タイムライン"
                                density="compact"
                                hide-details
                                v-on:update:model-value="onTypeChanged"
                            ></v-select>
                            <v-select
                                v-if="timelineType === 'channel'"
                                v-model="channelId"
                                v-bind:items="channelItems"
                                label="チャンネル"
                                density="compact"
                                hide-details
                                v-bind:loading="isLoadingChannels"
                                class="mt-3"
                                v-on:update:model-value="onChannelChanged"
                            ></v-select>
                        </v-card-text>
                    </v-card>
                </v-menu>
            </div>

            <!-- 広い画面 (isMobile === false) では、これまでどおり v-select をそのままインライン表示する -->
            <div v-if="isMobile === false && selectedAccount !== null && selectedAccount.provider === 'misskey'" class="type-row">
                <v-select
                    v-model="timelineType"
                    v-bind:items="typeItems"
                    label="タイムライン"
                    density="compact"
                    hide-details
                    class="type-select"
                    v-on:update:model-value="onTypeChanged"
                ></v-select>
                <v-select
                    v-if="timelineType === 'channel'"
                    v-model="channelId"
                    v-bind:items="channelItems"
                    label="チャンネル"
                    density="compact"
                    hide-details
                    v-bind:loading="isLoadingChannels"
                    class="channel-select"
                    v-on:update:model-value="onChannelChanged"
                ></v-select>
            </div>
        </div>

        <v-alert v-if="wsError !== null" type="warning" density="compact" variant="tonal" class="mt-2">
            <div class="d-flex align-center flex-wrap ga-2">
                <span class="text-caption">{{ wsError }}</span>
                <v-btn size="small" variant="outlined" v-on:click="reconnect">再接続</v-btn>
            </div>
        </v-alert>

        <div v-if="selectedAccount === null" class="text-body-2 empty">表示するアカウントがありません</div>

        <div v-else ref="list" class="note-list" v-on:scroll="onScroll">
            <SnsTimelineNoteCard
                v-for="n in notes"
                v-bind:key="n.id"
                v-bind:note="n"
                v-bind:provider="selectedAccount.provider"
                v-bind:emojiMap="emojiMap"
                v-bind:misskeyEmojis="emojis"
                v-bind:isReactionPending="isNotePending(n.id)"
                v-on:toggle-reaction="onToggleReaction(n, $event)"
                v-on:add-reaction="onAddReaction(n, $event)"
                v-on:renote="onRenote(n)"
            ></SnsTimelineNoteCard>

            <div v-if="isLoadingInitial === true" class="loading">
                <v-progress-circular indeterminate size="24"></v-progress-circular>
            </div>
            <div v-else-if="notes.length === 0" class="text-body-2 empty">ノートがありません</div>

            <div v-if="isLoadingMore === true" class="loading">
                <v-progress-circular indeterminate size="20"></v-progress-circular>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import ISnsPostState from '@/model/state/sns/ISnsPostState';
import ISnsTimelineState from '@/model/state/sns/ISnsTimelineState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import SnsTimelineSocket from '@/util/SnsTimelineSocket';
import { markRaw } from 'vue';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';
import SnsTimelineNoteCard from './SnsTimelineNoteCard.vue';
import * as apid from '../../../../../api';

/**
 * SNS 投稿パネルの「タイムライン」タブ。
 * アカウントを 1 つ選んで表示する (複数アカウントの統合表示はしない)。
 * Misskey は WebSocket でリアルタイムに新着ノートを先頭へ差し込み、Bluesky は 20 秒間隔でポーリングする。
 * どちらも、このコンポーネントが unmount されたら (視聴画面を離れる、投稿タブへ切り替える等) 必ず停止する
 */
@Component({
    components: { SnsTimelineNoteCard },
})
class SnsTimelinePanel extends Vue {
    @Prop({ required: true })
    public accounts!: apid.SnsAccountItem[];

    private static readonly PAGE_SIZE = 20;
    private static readonly BLUESKY_POLL_INTERVAL_MS = 20000;
    // 一番下からこの距離 (px) まで来たら次ページを読み込む
    private static readonly LOAD_MORE_THRESHOLD_PX = 120;
    // notes 保持件数の上限。Misskey の WebSocket は接続している間ずっと新着を先頭へ積み続け、
    // 無限スクロールの loadMore() も末尾へ積み続けるため、上限を設けないと長時間の視聴で
    // 数千件まで膨らみ描画 (特に v-for + 画像) が固まる
    private static readonly MAX_NOTES = 500;
    // 上で間引くかどうかを、リストが先頭付近 (最新) を表示しているかで判定するためのしきい値 (px)
    private static readonly TRIM_NEAR_TOP_THRESHOLD_PX = 40;

    public selectedAccountId: apid.SnsAccountId | null = null;
    public timelineType: apid.SnsTimelineType = 'home';
    public channelId: string | null = null;
    public channels: apid.SnsMisskeyChannel[] = [];
    public isLoadingChannels: boolean = false;

    public notes: apid.SnsTimelineNote[] = [];
    public isLoadingInitial: boolean = false;
    public isLoadingMore: boolean = false;
    public wsError: string | null = null;

    // Misskey のカスタム絵文字一覧 (本文の :name: 解決 + リアクション追加ピッカー用)
    public emojis: apid.SnsMisskeyEmoji[] = [];

    private snsTimelineState: ISnsTimelineState = container.get<ISnsTimelineState>('ISnsTimelineState');
    private snsPostState: ISnsPostState = container.get<ISnsPostState>('ISnsPostState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    private cursor: string | null = null;
    private hasMore: boolean = true;
    private socket: SnsTimelineSocket | null = null;
    private pollTimer: number | null = null;
    // 処理中のノート id (連打によるレースを避ける)
    private pendingReactionNoteIds: Set<string> = new Set();
    public readonly typeItems: { title: string; value: apid.SnsTimelineType }[] = [
        { title: 'ホーム', value: 'home' },
        { title: 'ソーシャル', value: 'social' },
        { title: 'ローカル', value: 'local' },
        { title: 'チャンネル', value: 'channel' },
    ];

    public get selectedAccount(): apid.SnsAccountItem | null {
        return this.accounts.find(a => a.id === this.selectedAccountId) ?? null;
    }

    public get isMobile(): boolean {
        return this.$vuetify.display.smAndDown === true;
    }

    /**
     * アカウント選択の v-chip-group を表示するかどうか。
     * 狭い端末でアカウントが 1 つしか無いときは、切り替え手段として意味を持たないため出さない
     * (誰のタイムラインかは投稿タブ側のアカウント選択で分かる)
     */
    public get showAccountChipGroup(): boolean {
        return this.isMobile === false || this.accounts.length > 1;
    }

    // 狭い端末のフィルターボタンに出す現在のタイムライン種別名
    public get timelineTypeLabel(): string {
        return this.typeItems.find(item => item.value === this.timelineType)?.title ?? 'ホーム';
    }

    public get channelItems(): { title: string; value: string | null }[] {
        return this.channels.map(c => ({ title: c.name, value: c.id }));
    }

    public get emojiMap(): Map<string, string> {
        const map = new Map<string, string>();
        for (const e of this.emojis) {
            map.set(e.name, e.url);
        }

        return map;
    }

    public created(): void {
        if (this.accounts.length > 0) {
            this.selectedAccountId = this.accounts[0].id;
        }
        void this.resetAndLoad();
    }

    public unmounted(): void {
        this.stopSubscription();
    }

    public isNotePending(noteId: string): boolean {
        return this.pendingReactionNoteIds.has(noteId);
    }

    public onAccountChanged(): void {
        this.timelineType = 'home';
        this.channelId = null;
        void this.resetAndLoad();
    }

    public onTypeChanged(): void {
        this.channelId = null;
        void this.resetAndLoad();
    }

    public onChannelChanged(): void {
        void this.resetAndLoad();
    }

    public reconnect(): void {
        this.wsError = null;
        if (this.selectedAccount === null) return;

        if (this.selectedAccount.provider === 'misskey') {
            this.connectMisskeyWs();
        } else {
            void this.pollBluesky();
        }
    }

    /**
     * アカウント・タイムライン種別・チャンネルの選択が変わるたびに、購読/ポーリングを張り直し、
     * 一覧を空から取得し直す
     */
    private async resetAndLoad(): Promise<void> {
        this.stopSubscription();
        this.notes = [];
        this.cursor = null;
        this.hasMore = true;
        this.wsError = null;
        this.emojis = [];
        this.pendingReactionNoteIds.clear();

        const account = this.selectedAccount;
        if (account === null) return;

        if (account.provider === 'misskey') {
            await this.fetchEmojis(account.id);
            if (this.timelineType === 'channel') {
                await this.fetchChannels(account.id);
            }
        }

        await this.fetchInitial();

        // アカウント切り替え等の連打で購読が積み残らないよう、最新の選択と一致する場合のみ張る
        if (this.selectedAccount?.id !== account.id) return;
        if (account.provider === 'misskey') {
            this.connectMisskeyWs();
        } else {
            this.pollTimer = window.setInterval(this.pollBluesky, SnsTimelinePanel.BLUESKY_POLL_INTERVAL_MS);
        }
    }

    private stopSubscription(): void {
        if (this.socket !== null) {
            this.socket.close();
            this.socket = null;
        }
        if (this.pollTimer !== null) {
            window.clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    private connectMisskeyWs(): void {
        if (this.socket !== null) {
            this.socket.close();
        }

        // markRaw() が必須: vue-facing-decorator のクラスプロパティは Vue のリアクティブ監視の対象になるため
        this.socket = markRaw(
            new SnsTimelineSocket({
                onNote: note => {
                    // 同じ note が WebSocket から二重に届くと :key (note.id) が重複してしまうため、
                    // 取り込み前に既存 id を弾く
                    if (this.notes.some(n => n.id === note.id) === true) return;

                    this.notes.unshift(note);
                    this.trimNotesIfNeeded();
                },
                onSubscribed: () => {
                    this.wsError = null;
                },
                onError: message => {
                    this.wsError = message;
                },
            }),
        );

        const account = this.selectedAccount;
        if (account === null) return;

        this.socket.connect({
            accountId: account.id,
            timelineType: this.timelineType,
            channelId: this.timelineType === 'channel' ? (this.channelId ?? undefined) : undefined,
        });
    }

    /**
     * Bluesky のポーリング。新着を追加し、既存ノートのリアクション状態も同期する
     */
    private async pollBluesky(): Promise<void> {
        const account = this.selectedAccount;
        if (account === null || account.provider !== 'bluesky') return;

        try {
            const timeline = await this.snsTimelineState.getTimeline(account.id, undefined, undefined, SnsTimelinePanel.PAGE_SIZE);
            this.wsError = null;

            // notes.find() をポーリングのたびに timeline.notes の件数分回すと O(n^2) になるため、
            // id -> note の Map を 1 回だけ組み立てて引く
            const existingById = new Map(this.notes.map(n => [n.id, n]));

            const newNotes: apid.SnsTimelineNote[] = [];
            for (const timelineNote of timeline.notes) {
                const existing = existingById.get(timelineNote.id);
                if (typeof existing === 'undefined') {
                    newNotes.push(timelineNote);
                    continue;
                }

                existing.reactions = timelineNote.reactions;
                existing.renoteCount = timelineNote.renoteCount;
                existing.isRenotedByMe = timelineNote.isRenotedByMe;
                existing.repostKey = timelineNote.repostKey;
            }
            for (const n of newNotes.reverse()) {
                this.notes.unshift(n);
            }
            if (newNotes.length > 0) {
                this.trimNotesIfNeeded();
            }
        } catch (err) {
            console.error(err);
            // ポーリングの単発失敗はスナックバーを出さず、次回のポーリングに任せる
        }
    }

    private async fetchEmojis(accountId: apid.SnsAccountId): Promise<void> {
        try {
            this.emojis = await this.snsTimelineState.getMisskeyEmojis(accountId);
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'カスタム絵文字一覧の取得に失敗しました' });
        }
    }

    private async fetchChannels(accountId: apid.SnsAccountId): Promise<void> {
        this.isLoadingChannels = true;
        try {
            this.channels = await this.snsPostState.getMisskeyChannels(accountId);
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'Misskey のチャンネル一覧の取得に失敗しました' });
        }
        this.isLoadingChannels = false;
    }

    private async fetchInitial(): Promise<void> {
        const account = this.selectedAccount;
        if (account === null) return;
        if (account.provider === 'misskey' && this.timelineType === 'channel' && this.channelId === null) {
            // チャンネル未選択では取得しない
            return;
        }

        this.isLoadingInitial = true;
        try {
            const timeline = await this.snsTimelineState.getTimeline(
                account.id,
                this.timelineType,
                this.channelId ?? undefined,
                SnsTimelinePanel.PAGE_SIZE,
            );
            if (this.selectedAccount?.id !== account.id) return;
            this.notes = timeline.notes;
            this.cursor = timeline.cursor;
            this.hasMore = timeline.cursor !== null;
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'タイムラインの取得に失敗しました' });
        }
        this.isLoadingInitial = false;
    }

    private async loadMore(): Promise<void> {
        const account = this.selectedAccount;
        if (account === null || this.isLoadingMore === true || this.hasMore === false || this.cursor === null) return;

        this.isLoadingMore = true;
        try {
            const timeline = await this.snsTimelineState.getTimeline(
                account.id,
                this.timelineType,
                this.channelId ?? undefined,
                SnsTimelinePanel.PAGE_SIZE,
                this.cursor,
            );
            if (this.selectedAccount?.id !== account.id) return;
            this.notes.push(...timeline.notes);
            this.cursor = timeline.cursor;
            this.hasMore = timeline.cursor !== null;
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'タイムラインの追加読み込みに失敗しました' });
        }
        this.isLoadingMore = false;
    }

    /**
     * notes が上限件数を超えたら末尾 (古いノート) から間引く。
     * ただし、ユーザーが下へスクロールして末尾側 (古いノート) を読んでいる最中に間引くと
     * 読んでいたものが急に消える体験になるため、リストが先頭付近 (最新) を表示しているときだけ間引く。
     * 下へスクロールしている間は見送り、先頭へ戻ったタイミング (次の新着やポーリング) で追いつく
     */
    private trimNotesIfNeeded(): void {
        if (this.notes.length <= SnsTimelinePanel.MAX_NOTES) return;

        const list = this.$refs.list as HTMLElement | undefined;
        const isNearTop = typeof list === 'undefined' || list.scrollTop <= SnsTimelinePanel.TRIM_NEAR_TOP_THRESHOLD_PX;
        if (isNearTop === false) return;

        this.notes.length = SnsTimelinePanel.MAX_NOTES;
        // 末尾を切り捨てた以上、そこから続きを読み込む前提が崩れるため、次のページ取得は無効にする
        // (押し出したノートより後ろのページを cursor で辿ると穴が空くため)
        this.hasMore = false;
    }

    public onScroll(): void {
        const list = this.$refs.list as HTMLElement | undefined;
        if (typeof list === 'undefined') return;

        if (list.scrollHeight - list.scrollTop - list.clientHeight < SnsTimelinePanel.LOAD_MORE_THRESHOLD_PX) {
            void this.loadMore();
        }
    }

    /**
     * 既存リアクション chip の押下 (自分が付けていれば取り消し、付けていなければ同じものを付ける)
     */
    public async onToggleReaction(note: apid.SnsTimelineNote, reaction: apid.SnsTimelineReaction): Promise<void> {
        const account = this.selectedAccount;
        if (account === null || this.pendingReactionNoteIds.has(note.id) === true) return;

        const wasMine = reaction.isMine;

        if (account.provider === 'bluesky' && wasMine === true && typeof reaction.reactionKey !== 'string') {
            this.snackbarState.open({ color: 'normal', text: 'このセッションより前に付けたリアクションはこの画面では取り消せません' });

            return;
        }

        this.pendingReactionNoteIds.add(note.id);
        this.applyReactionOptimistic(note, reaction.name, wasMine === false, reaction.url);

        try {
            let result: apid.SnsReactionResult;
            if (wasMine === true) {
                const option: apid.SnsReactionOption = { accountId: account.id, noteId: note.id };
                if (account.provider === 'bluesky') {
                    option.reactionKey = reaction.reactionKey;
                } else {
                    option.reaction = reaction.name;
                }
                result = await this.snsTimelineState.removeReaction(option);
            } else {
                const option: apid.SnsReactionOption = { accountId: account.id, noteId: note.id, reaction: reaction.name, cid: note.cid };
                result = await this.snsTimelineState.addReaction(option);
                if (result.isSuccess === true && account.provider === 'bluesky' && typeof result.reactionKey === 'string') {
                    const updated = note.reactions.find(r => r.name === reaction.name);
                    if (typeof updated !== 'undefined') updated.reactionKey = result.reactionKey;
                }
            }

            if (result.isSuccess === false) {
                this.applyReactionOptimistic(note, reaction.name, wasMine === true, reaction.url);
                this.snackbarState.open({ color: 'error', text: `リアクションの操作に失敗しました${typeof result.detail === 'string' ? ` (${result.detail})` : ''}` });
            }
        } catch (err) {
            console.error(err);
            this.applyReactionOptimistic(note, reaction.name, wasMine === true, reaction.url);
            this.snackbarState.open({ color: 'error', text: 'リアクションの操作に失敗しました' });
        } finally {
            this.pendingReactionNoteIds.delete(note.id);
        }
    }

    /**
     * 絵文字ピッカーから新しいリアクションを選んだとき (Misskey のみ)
     */
    public async onAddReaction(note: apid.SnsTimelineNote, emojiName: string): Promise<void> {
        const account = this.selectedAccount;
        if (account === null || account.provider !== 'misskey' || this.pendingReactionNoteIds.has(note.id) === true) return;

        const reactionName = `:${emojiName}:`;
        const existing = note.reactions.find(r => r.name === reactionName);
        if (existing?.isMine === true) return;

        this.pendingReactionNoteIds.add(note.id);
        // Misskey は 1 ノートにつき自分のリアクションは 1 つまでのため、他のリアクションが付いていれば楽観的に外す
        const previousMine = note.reactions.find(r => r.isMine === true && r.name !== reactionName) ?? null;
        this.applyReactionOptimistic(note, reactionName, true);

        try {
            let result: apid.SnsReactionResult;
            if (previousMine !== null) {
                result = await this.snsTimelineState.removeReaction({
                    accountId: account.id,
                    noteId: note.id,
                    reaction: previousMine.name,
                });
                if (result.isSuccess === false) {
                    this.applyReactionOptimistic(note, reactionName, false);
                    this.applyReactionOptimistic(note, previousMine.name, true);
                    this.snackbarState.open({ color: 'error', text: `リアクションの変更に失敗しました${typeof result.detail === 'string' ? ` (${result.detail})` : ''}` });
                    return;
                }
            }

            result = await this.snsTimelineState.addReaction({ accountId: account.id, noteId: note.id, reaction: reactionName });
            if (result.isSuccess === false) {
                this.applyReactionOptimistic(note, reactionName, false);
                if (previousMine !== null) {
                    const restore = await this.snsTimelineState.addReaction({ accountId: account.id, noteId: note.id, reaction: previousMine.name });
                    if (restore.isSuccess === true) this.applyReactionOptimistic(note, previousMine.name, true);
                }
                this.snackbarState.open({ color: 'error', text: `リアクションの追加に失敗しました${typeof result.detail === 'string' ? ` (${result.detail})` : ''}` });
            }
        } catch (err) {
            console.error(err);
            this.applyReactionOptimistic(note, reactionName, false);
            if (previousMine !== null) {
                try {
                    const restore = await this.snsTimelineState.addReaction({ accountId: account.id, noteId: note.id, reaction: previousMine.name });
                    if (restore.isSuccess === true) this.applyReactionOptimistic(note, previousMine.name, true);
                } catch (restoreErr) {
                    console.error(restoreErr);
                }
            }
            this.snackbarState.open({ color: 'error', text: 'リアクションの追加に失敗しました' });
        } finally {
            this.pendingReactionNoteIds.delete(note.id);
        }
    }

    /**
     * note.reactions を楽観的に更新する (追加・取り消しの両方に使う共通処理)
     * @param note: apid.SnsTimelineNote
     * @param reactionName: string
     * @param toMine: true の場合そのリアクションを自分が付けた状態にし、false の場合取り消した状態にする
     * @param fallbackUrl: string | null | undefined チップが 0 件になって配列から消えていた場合に
     *   巻き戻しで作り直すときの画像 URL (取り消し前の `reaction.url` を渡す)
     */
    private applyReactionOptimistic(note: apid.SnsTimelineNote, reactionName: string, toMine: boolean, fallbackUrl?: string | null): void {
        const target = note.reactions.find(r => r.name === reactionName);

        if (toMine === true) {
            if (typeof target === 'undefined') {
                const emoji = this.emojis.find(e => `:${e.name}:` === reactionName);
                note.reactions = [...note.reactions, { name: reactionName, count: 1, url: fallbackUrl ?? emoji?.url ?? null, isMine: true }];
            } else if (target.isMine === false) {
                target.isMine = true;
                target.count += 1;
            }

            return;
        }

        if (typeof target === 'undefined' || target.isMine === false) return;

        target.isMine = false;
        target.count = Math.max(0, target.count - 1);
        if (target.count === 0) {
            note.reactions = note.reactions.filter(r => r !== target);
        }
    }

    /**
     * リノート / repost。取り消しには対応しない (Misskey・Bluesky ともに API 未実装のため、
     * ボタンは isRenotedByMe === true で無効化しておりここには来ない想定)
     */
    public async onRenote(note: apid.SnsTimelineNote): Promise<void> {
        const account = this.selectedAccount;
        if (account === null || note.isRenotedByMe === true) return;

        const previousCount = note.renoteCount;
        note.isRenotedByMe = true;
        note.renoteCount += 1;

        try {
            const result = await this.snsTimelineState.renote({ accountId: account.id, noteId: note.id, cid: note.cid });
            if (result.isSuccess === false) {
                note.isRenotedByMe = false;
                note.renoteCount = previousCount;
                this.snackbarState.open({ color: 'error', text: `リノートに失敗しました${typeof result.detail === 'string' ? ` (${result.detail})` : ''}` });
            }
        } catch (err) {
            console.error(err);
            note.isRenotedByMe = false;
            note.renoteCount = previousCount;
            this.snackbarState.open({ color: 'error', text: 'リノートに失敗しました' });
        }
    }

    @Watch('accounts', { deep: true })
    public onAccountsListChanged(): void {
        if (this.accounts.some(a => a.id === this.selectedAccountId) === true) return;

        this.selectedAccountId = this.accounts.length > 0 ? this.accounts[0].id : null;
        void this.resetAndLoad();
    }
}

export default toNative(SnsTimelinePanel);
</script>

<style lang="sass" scoped>
.sns-timeline-panel
    display: flex
    flex-direction: column
    height: 100%
    min-height: 0

    .tl-controls
        flex: 0 0 auto

        .chip-label
            max-width: 140px
            overflow: hidden
            text-overflow: ellipsis
            white-space: nowrap

        // アカウント選択 (v-chip-group) とタイムライン種別フィルター (狭い端末ではアイコンボタン) の行。
        // 狭い端末ではこの 1 行に収め、.note-list (ノート一覧) へ高さを渡す
        .top-row
            display: flex
            align-items: center
            flex-wrap: wrap
            gap: 8px

            .account-chip-group
                flex: 1 1 auto
                min-width: 0

            .type-filter-btn
                flex: 0 0 auto

        // 広い画面のみ使う、種別 + チャンネルのインライン v-select
        .type-row
            display: flex
            flex-wrap: wrap
            gap: 8px
            margin-top: 8px

            .type-select
                flex: 1 1 140px
                min-width: 0

            .channel-select
                flex: 1 1 140px
                min-width: 0

    .note-list
        flex: 1 1 auto
        min-height: 0
        overflow-y: auto
        margin-top: 8px

    .loading
        display: flex
        justify-content: center
        padding: 12px

    .empty
        color: var(--watch-fg-dim)
        text-align: center
        padding: 24px 0

// v-menu の中身は document.body 直下へテレポートされるため .sns-timeline-panel の子孫としてネストさせない。
// v-card の max-width prop はインラインスタイルとなり .menu-card (共通クラス) の
// max-width: calc(100vw - 32px) より強くなってしまうため、希望幅は width で持たせる
.timeline-menu-card
    width: 280px
</style>
