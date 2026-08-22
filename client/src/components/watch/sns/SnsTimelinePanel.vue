<template>
    <div class="sns-timeline-panel">
        <div class="tl-controls">
            <v-chip-group v-model="selectedAccountId" mandatory selected-class="text-primary" v-on:update:model-value="onAccountChanged">
                <v-chip v-for="a in accounts" v-bind:key="a.id" v-bind:value="a.id" size="small" variant="outlined">
                    <v-avatar start size="18">
                        <v-img v-if="a.avatarUrl !== null" v-bind:src="a.avatarUrl"></v-img>
                        <v-icon v-else size="14">{{ a.provider === 'bluesky' ? 'mdi-butterfly-outline' : 'mdi-account-circle' }}</v-icon>
                    </v-avatar>
                    <span class="chip-label">{{ a.displayName }}</span>
                </v-chip>
            </v-chip-group>

            <div v-if="selectedAccount !== null && selectedAccount.provider === 'misskey'" class="type-row">
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
    // このセッション内で自分が作成した Bluesky like の rkey (noteId -> reactionKey)。
    // 取り消し (DELETE) には作成時のレスポンスの reactionKey が必須なため、これを持たない
    // (= 別セッションで付けた) like はこの画面では取り消せない
    private blueskyReactionKeys: Map<string, string> = new Map();

    public readonly typeItems: { title: string; value: apid.SnsTimelineType }[] = [
        { title: 'ホーム', value: 'home' },
        { title: 'ソーシャル', value: 'social' },
        { title: 'ローカル', value: 'local' },
        { title: 'チャンネル', value: 'channel' },
    ];

    public get selectedAccount(): apid.SnsAccountItem | null {
        return this.accounts.find(a => a.id === this.selectedAccountId) ?? null;
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
        this.blueskyReactionKeys.clear();
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
                    this.notes.unshift(note);
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
     * Bluesky のポーリング。既存ノートに無い id だけを新着として先頭へ差し込む
     */
    private async pollBluesky(): Promise<void> {
        const account = this.selectedAccount;
        if (account === null || account.provider !== 'bluesky') return;

        try {
            const timeline = await this.snsTimelineState.getTimeline(account.id, undefined, undefined, SnsTimelinePanel.PAGE_SIZE);
            this.wsError = null;

            const existingIds = new Set(this.notes.map(n => n.id));
            const newNotes = timeline.notes.filter(n => existingIds.has(n.id) === false);
            for (const n of newNotes.reverse()) {
                this.notes.unshift(n);
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

        if (account.provider === 'bluesky' && wasMine === true && this.blueskyReactionKeys.has(note.id) === false) {
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
                    option.reactionKey = this.blueskyReactionKeys.get(note.id);
                } else {
                    option.reaction = reaction.name;
                }
                result = await this.snsTimelineState.removeReaction(option);
                if (result.isSuccess === true) {
                    this.blueskyReactionKeys.delete(note.id);
                }
            } else {
                const option: apid.SnsReactionOption = { accountId: account.id, noteId: note.id, reaction: reaction.name, cid: note.cid };
                result = await this.snsTimelineState.addReaction(option);
                if (result.isSuccess === true && account.provider === 'bluesky' && typeof result.reactionKey !== 'undefined') {
                    this.blueskyReactionKeys.set(note.id, result.reactionKey);
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
        }
        this.pendingReactionNoteIds.delete(note.id);
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
            const result = await this.snsTimelineState.addReaction({ accountId: account.id, noteId: note.id, reaction: reactionName });
            if (result.isSuccess === false) {
                this.applyReactionOptimistic(note, reactionName, false);
                if (previousMine !== null) {
                    this.applyReactionOptimistic(note, previousMine.name, true);
                }
                this.snackbarState.open({ color: 'error', text: `リアクションの追加に失敗しました${typeof result.detail === 'string' ? ` (${result.detail})` : ''}` });
            }
        } catch (err) {
            console.error(err);
            this.applyReactionOptimistic(note, reactionName, false);
            if (previousMine !== null) {
                this.applyReactionOptimistic(note, previousMine.name, true);
            }
            this.snackbarState.open({ color: 'error', text: 'リアクションの追加に失敗しました' });
        }
        this.pendingReactionNoteIds.delete(note.id);
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
</style>
