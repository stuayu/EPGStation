<template>
    <div class="sns-note-card">
        <div class="note-header">
            <v-avatar size="32" class="avatar">
                <v-img v-if="note.author.avatarUrl !== null" v-bind:src="note.author.avatarUrl" referrerpolicy="no-referrer"></v-img>
                <v-icon v-else size="20">mdi-account-circle</v-icon>
            </v-avatar>
            <div class="header-text">
                <div class="display-name">{{ note.author.displayName === '' ? note.author.handle : note.author.displayName }}</div>
                <div class="handle text-caption">@{{ note.author.handle }}</div>
            </div>
            <div class="time text-caption">{{ relativeTime }}</div>
        </div>

        <div v-if="note.cw !== null" class="cw">
            <v-btn size="x-small" variant="outlined" v-on:click="isCwOpen = !isCwOpen">
                {{ isCwOpen === true ? '内容を隠す' : '内容を見る (CW)' }}
            </v-btn>
            <div class="cw-text"><MfmText v-bind:nodes="cwNodes" v-bind:emojiMap="emojiMap"></MfmText></div>
        </div>

        <div v-if="note.cw === null || isCwOpen === true" class="note-body">
            <MfmText v-bind:nodes="bodyNodes" v-bind:emojiMap="emojiMap"></MfmText>

            <div v-if="note.images.length > 0" class="images" v-bind:class="`count-${Math.min(note.images.length, 4)}`">
                <div
                    v-for="(img, i) in note.images"
                    v-bind:key="i"
                    class="image-cell"
                    v-bind:class="{ 'is-sensitive': img.isSensitive === true && revealed[i] !== true }"
                    v-on:click="onImageClick(img, i)"
                >
                    <img v-bind:src="img.thumbnailUrl ?? img.url" loading="lazy" referrerpolicy="no-referrer" />
                    <div v-if="img.isSensitive === true && revealed[i] !== true" class="sensitive-overlay">
                        <v-icon size="20">mdi-eye-off-outline</v-icon>
                        <span class="text-caption">閲覧注意 (タップで表示)</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="note-footer">
            <div class="reactions">
                <v-chip
                    v-for="r in note.reactions"
                    v-bind:key="r.name"
                    size="small"
                    v-bind:color="r.isMine === true ? 'primary' : undefined"
                    v-bind:variant="r.isMine === true ? 'flat' : 'outlined'"
                    v-bind:disabled="isReactionPending === true"
                    v-on:click="$emit('toggle-reaction', r)"
                >
                    <img
                        v-if="resolveReactionUrl(r) !== null"
                        v-bind:src="resolveReactionUrl(r) ?? undefined"
                        referrerpolicy="no-referrer"
                        class="reaction-emoji"
                    />
                    <span v-else>{{ reactionDisplayText(r) }}</span>
                    <span class="reaction-count ml-1">{{ r.count }}</span>
                </v-chip>

                <v-menu v-if="provider === 'misskey'" v-bind:close-on-content-click="false" location="top">
                    <template v-slot:activator="{ props }">
                        <v-btn icon size="x-small" variant="text" v-bind="props" v-bind:disabled="isReactionPending === true" title="リアクションを追加">
                            <v-icon size="16">mdi-emoticon-plus-outline</v-icon>
                        </v-btn>
                    </template>
                    <v-card class="menu-card reaction-menu-card">
                        <v-card-text class="menu-card-body">
                            <SnsEmojiPicker v-bind:emojis="misskeyEmojis" v-on:select="onAddReaction"></SnsEmojiPicker>
                        </v-card-text>
                    </v-card>
                </v-menu>
            </div>

            <div class="actions">
                <v-btn size="small" variant="text" v-bind:disabled="note.isRenotedByMe === true" v-bind:title="renoteTitle" v-on:click="$emit('renote')">
                    <v-icon size="16">mdi-repeat-variant</v-icon>
                    <span v-if="note.renoteCount > 0" class="ml-1">{{ note.renoteCount }}</span>
                </v-btn>
                <v-btn v-if="note.url !== null" size="small" variant="text" v-bind:href="note.url" target="_blank" rel="noopener noreferrer" title="元の投稿を開く">
                    <v-icon size="16">mdi-open-in-new</v-icon>
                </v-btn>
            </div>
        </div>

        <v-dialog v-model="isImageDialogOpen" v-bind:fullscreen="isMobile === true" max-width="960" scrollable>
            <v-card v-if="previewImageUrl !== null" class="preview-card">
                <div class="preview-toolbar">
                    <v-spacer></v-spacer>
                    <v-btn icon size="small" variant="text" title="閉じる" v-on:click="isImageDialogOpen = false">
                        <v-icon>mdi-close</v-icon>
                    </v-btn>
                </div>
                <div class="preview-body">
                    <img v-bind:src="previewImageUrl" referrerpolicy="no-referrer" class="preview-image" />
                </div>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts">
import DateUtil from '@/util/DateUtil';
import { MfmNode, parseMfm } from '@/util/MfmRenderUtil';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';
import MfmText from './MfmText.vue';
import SnsEmojiPicker from './SnsEmojiPicker.vue';
import * as apid from '../../../../../api';

/**
 * SNS タイムラインのノート (投稿) 1 件分のカード。
 * リアクション・リノートの実際の API 呼び出しと楽観更新/巻き戻しは呼び出し側 (SnsTimelinePanel) が行い、
 * このコンポーネントはユーザー操作の意図をイベントとして伝えるだけ (CW の開閉・画像プレビューは自己完結)
 *
 * アバター・添付画像・カスタム絵文字は Misskey/Bluesky 側のメディアサーバーから直接読み込む。
 * Misskey のメディアプロキシ (media.misskeyusercontent.jp 等) は Referer を見てホットリンクとみなし
 * 403 を返すことがある (実測確認済み) ため、これら外部由来の img はすべて referrerpolicy="no-referrer" を付ける
 */
@Component({
    components: { MfmText, SnsEmojiPicker },
})
class SnsTimelineNoteCard extends Vue {
    @Prop({ required: true })
    public note!: apid.SnsTimelineNote;

    @Prop({ required: true })
    public provider!: apid.SnsProvider;

    // 本文中の :name: をカスタム絵文字画像へ解決するための name -> url マップ
    @Prop({ required: false, default: () => new Map() })
    public emojiMap!: Map<string, string>;

    // リアクション追加ピッカー用 (Misskey のみ使用)
    @Prop({ required: false, default: () => [] })
    public misskeyEmojis!: apid.SnsMisskeyEmoji[];

    // このノートに対するリアクション操作が処理中かどうか (連打によるレースを避けるため呼び出し側で管理する)
    @Prop({ required: false, default: false })
    public isReactionPending!: boolean;

    public isCwOpen: boolean = false;
    public revealed: boolean[] = [];
    public previewImageUrl: string | null = null;

    public created(): void {
        this.revealed = this.note.images.map(() => false);
    }

    public get isMobile(): boolean {
        return this.$vuetify.display.smAndDown === true;
    }

    public get relativeTime(): string {
        return DateUtil.getRelativeTimeString(this.note.createdAt);
    }

    public get bodyNodes(): MfmNode[] {
        return parseMfm(this.note.text);
    }

    public get cwNodes(): MfmNode[] {
        return parseMfm(this.note.cw);
    }

    public get renoteTitle(): string {
        if (this.note.isRenotedByMe === false) {
            return this.provider === 'bluesky' ? 'repost' : 'リノート';
        }

        return this.provider === 'bluesky' ? 'repost 済み (この画面では取り消せません)' : 'リノート済み';
    }

    public get isImageDialogOpen(): boolean {
        return this.previewImageUrl !== null;
    }

    public set isImageDialogOpen(value: boolean) {
        if (value === false) {
            this.previewImageUrl = null;
        }
    }

    /**
     * 画像クリック時の処理。センシティブでまだ表示していない画像は最初のクリックでぼかしを解除するだけにし、
     * 2 回目のクリックまたは非センシティブ画像のクリックで原寸プレビューを開く
     * @param img: apid.SnsTimelineImage
     * @param index: number
     */
    public onImageClick(img: apid.SnsTimelineImage, index: number): void {
        if (img.isSensitive === true && this.revealed[index] !== true) {
            this.revealed[index] = true;

            return;
        }

        this.previewImageUrl = img.url;
    }

    public onAddReaction(emoji: apid.SnsMisskeyEmoji): void {
        this.$emit('add-reaction', emoji.name);
    }

    /**
     * リアクションの画像 URL を解決する。サーバーが解決できず `url: null` で返してきた場合でも、
     * 手元の絵文字一覧 (`emojiMap`、本文中のカスタム絵文字と同じもの) から名前で解決を試みる
     * (WebSocket 中継の note はサーバー側のキャッシュ更新前に流れてくることがあるため)
     * @param r: apid.SnsTimelineReaction
     * @return string | null
     */
    public resolveReactionUrl(r: apid.SnsTimelineReaction): string | null {
        if (r.url !== null) {
            return r.url;
        }

        const match = SnsTimelineNoteCard.REACTION_KEY_PATTERN.exec(r.name);
        if (match === null) {
            return null;
        }

        return this.emojiMap.get(match[1]) ?? null;
    }

    /**
     * リアクションを画像で表示できない場合のテキスト表示。
     * `:name:` 形式のリアクションは `:` を外した短い名前 (ホスト部分も除く) だけを出し、
     * Unicode 絵文字 (そもそも `:name:` 形式にマッチしない) はこれまでどおり文字をそのまま出す
     * @param r: apid.SnsTimelineReaction
     * @return string
     */
    public reactionDisplayText(r: apid.SnsTimelineReaction): string {
        const match = SnsTimelineNoteCard.REACTION_KEY_PATTERN.exec(r.name);

        return match !== null ? match[1] : r.name;
    }
}

namespace SnsTimelineNoteCard {
    // サーバー側 (MisskeyTimelineConverter) と同じ形式。ローカルは ':name:' / ':name@.:'、
    // リモートは ':name@host:'。name 部分だけを取り出す (host は emojiMap がローカルの一覧のため使わない)
    export const REACTION_KEY_PATTERN = /^:([^:@]+)(?:@([^:]+))?:$/;
}

export default toNative(SnsTimelineNoteCard);
</script>

<style lang="sass" scoped>
.sns-note-card
    padding: 10px 4px
    border-bottom: 1px solid var(--watch-border-subtle)

    .note-header
        display: flex
        align-items: flex-start
        gap: 8px

        .avatar
            flex: 0 0 auto

        .header-text
            flex: 1 1 auto
            min-width: 0

            .display-name
                font-weight: bold
                font-size: 0.9rem
                overflow: hidden
                text-overflow: ellipsis
                white-space: nowrap

            .handle
                color: var(--watch-fg-dim)
                overflow: hidden
                text-overflow: ellipsis
                white-space: nowrap

        .time
            flex: 0 0 auto
            color: var(--watch-fg-dim)
            white-space: nowrap

    .cw
        margin-top: 6px

        .cw-text
            margin-top: 4px
            font-size: 0.85rem
            color: var(--watch-fg-dim)

    .note-body
        margin-top: 6px
        font-size: 0.9rem

    .images
        display: grid
        grid-template-columns: repeat(2, 1fr)
        gap: 4px
        margin-top: 6px

        &.count-1
            grid-template-columns: 1fr

    .image-cell
        position: relative
        aspect-ratio: 16 / 9
        border-radius: 6px
        overflow: hidden
        cursor: pointer
        background: rgba(0, 0, 0, 0.3)

        img
            width: 100%
            height: 100%
            object-fit: cover
            display: block

        &.is-sensitive img
            filter: blur(20px)

        .sensitive-overlay
            position: absolute
            inset: 0
            display: flex
            flex-direction: column
            align-items: center
            justify-content: center
            gap: 2px
            color: #fff
            text-align: center
            padding: 4px

    .note-footer
        display: flex
        align-items: center
        flex-wrap: wrap
        gap: 4px
        margin-top: 6px

        // flex-basis を auto (既定) のままにすると、リアクション chip が多いときに
        // このコンテナの「折り返さなかった場合の幅」(= 全 chip を 1 行に並べた幅) が
        // wrap 判定の基準になり、.actions が行から押し出されてしまう。
        // basis を 0% にして wrap 判定を無視し、.reactions 自身の内部 wrap (chip 単位) に任せる
        .reactions
            display: flex
            align-items: center
            flex-wrap: wrap
            gap: 4px
            flex: 1 1 0%
            min-width: 0

        .actions
            display: flex
            align-items: center
            flex: 0 0 auto

    .reaction-emoji
        height: 1.1em
        width: auto
        vertical-align: middle
        object-fit: contain

// v-menu / v-dialog の中身は document.body 直下へテレポートされるためネストさせない。
// v-card の max-width prop はインラインスタイルとなり .menu-card (共通クラス) の
// max-width: calc(100vw - 32px) より強くなってしまうため、希望幅は width で持たせる
.reaction-menu-card
    width: 320px

.preview-card
    display: flex
    flex-direction: column
    max-height: inherit

.preview-toolbar
    display: flex
    align-items: center
    flex: 0 0 auto
    padding: 4px

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
