<template>
    <div class="watch-panel-comments">
        <div class="d-flex justify-end px-2"><v-btn size="x-small" variant="text" @click="muteDialog = true">ミュート設定</v-btn></div>
        <JikkyoCommentMuteDialog v-model="muteDialog"></JikkyoCommentMuteDialog>
        <v-snackbar v-model="snackbar" timeout="2500">{{ snackbarText }}</v-snackbar>
        <div ref="list" class="list" v-on:scroll="onScroll">
            <v-menu v-for="(comment, index) in visibleComments" :key="index" location="end">
                <template #activator="{ props }">
                    <div class="comment" v-bind="props" @click="selectedComment = comment">
                        <div class="text" :style="{ color: getCommentColor(comment) }">
                            {{ comment.text }}
                            <span v-if="comment.isSelf" class="self-label">自分</span>
                        </div>
                    </div>
                </template>
                <v-card class="menu-card" width="220">
                    <v-list density="compact" class="menu-card-body">
                        <v-list-item title="このユーザーをミュート" :disabled="!selectedComment?.userId" @click="muteUser(selectedComment!.userId!)"></v-list-item>
                        <v-list-item title="このコメントをミュート" @click="muteKeyword(selectedComment!.text)"></v-list-item>
                        <v-list-item title="コピー" @click="copyComment(selectedComment!.text)"></v-list-item>
                    </v-list>
                </v-card>
            </v-menu>
            <div v-if="errorMessage !== null" class="empty text-body-2">{{ errorMessage }}</div>
            <div v-if="comments.length === 0 && errorMessage === null" class="empty text-body-2">コメントはまだありません</div>
        </div>
        <div v-if="isFollowing === false" class="follow">
            <v-btn size="small" variant="tonal" v-on:click="scrollToBottom">最新のコメントへ</v-btn>
        </div>
    </div>
</template>

<script lang="ts">
import { JikkyoComment } from '@/util/JikkyoCommentClient';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';
import JikkyoCommentMuteDialog from '@/components/watch/JikkyoCommentMuteDialog.vue';
import container from '@/model/ModelContainer';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import { isMutedComment } from '@/util/CommentMuteUtil';

/**
 * 右パネルの「コメント」タブの中身
 * 映像に流れている実況コメントを時系列で並べる
 */
@Component({ components: { JikkyoCommentMuteDialog } })
class WatchPanelComments extends Vue {
    public muteDialog = false;
    public snackbar = false;
    public snackbarText = '';
    public selectedComment: JikkyoComment | null = null;
    public muteRevision = 0;
    private settingStorage = container.get<ISettingStorageModel>('ISettingStorageModel');
    @Prop({ required: true })
    public comments!: JikkyoComment[];

    @Prop({ default: null })
    public errorMessage!: string | null;

    // ライトモードで背景に埋もれてしまう白系の指定色
    private static readonly WHITE_COLORS = ['#fff', '#ffffff', 'white', 'rgb(255, 255, 255)'];

    /**
     * 一番下に追従しているか (自分でスクロールを上げている間は自動追従しない)
     */
    public isFollowing: boolean = true;

    public mounted(): void {
        this.scrollToBottom();
    }

    public muteUser(userId: string): void {
        const settings = this.settingStorage.tmp.jikkyoCommentMuteSettings;
        settings.mutedUserIds = Array.from(new Set([...(settings.mutedUserIds ?? []), userId]));
        this.settingStorage.save();
        window.dispatchEvent(new Event('jikkyo-comment-mute-settings-updated'));
        this.muteRevision++;
        this.snackbarText = 'ユーザーをミュートしました';
        this.snackbar = true;
    }
    public muteKeyword(text: string): void {
        const settings = this.settingStorage.tmp.jikkyoCommentMuteSettings;
        settings.mutedKeywords = [...(settings.mutedKeywords ?? []), { match: 'partial', pattern: text }];
        this.settingStorage.save();
        window.dispatchEvent(new Event('jikkyo-comment-mute-settings-updated'));
        this.muteRevision++;
        this.snackbarText = 'コメントをミュートしました';
        this.snackbar = true;
    }
    public copyComment(text: string): void {
        void navigator.clipboard.writeText(text);
    }
    get visibleComments(): JikkyoComment[] {
        void this.muteRevision;
        const settings = this.settingStorage.tmp.jikkyoCommentMuteSettings;
        return this.comments.filter(
            comment => !isMutedComment(comment.text, settings, { userId: comment.userId, color: comment.color, position: comment.type, size: comment.size }),
        );
    }

    @Watch('comments')
    public onChangeComments(): void {
        if (this.isFollowing === false) {
            return;
        }

        this.$nextTick(() => {
            this.scrollToBottom();
        });
    }

    /**
     * コメントの文字色を返す
     * 実況コメントの既定色は白のため、ライトモードでは背景に埋もれて読めなくなる。
     * 白系のときだけ undefined を返し、CSS 側のテーマ色 (--watch-fg) を使わせる
     * @param comment: JikkyoComment
     * @return string | undefined
     */
    public getCommentColor(comment: JikkyoComment): string | undefined {
        if (this.$vuetify.theme.global.current.dark === true) {
            return comment.color;
        }

        return WatchPanelComments.WHITE_COLORS.includes(comment.color.trim().toLowerCase()) === true ? undefined : comment.color;
    }

    public onScroll(): void {
        const list = this.$refs.list as HTMLElement | undefined;
        if (typeof list === 'undefined') {
            return;
        }

        // 末尾付近にいるときだけ追従する
        this.isFollowing = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
    }

    public scrollToBottom(): void {
        const list = this.$refs.list as HTMLElement | undefined;
        if (typeof list === 'undefined') {
            return;
        }

        list.scrollTop = list.scrollHeight;
        this.isFollowing = true;
    }
}

export default toNative(WatchPanelComments);
</script>

<style lang="sass" scoped>
.watch-panel-comments
    position: relative
    display: flex
    flex-direction: column
    height: 100%

    .list
        flex: 1 1 auto
        min-height: 0
        overflow-y: auto
        padding: 8px

    .comment
        padding: 3px 2px
        border-bottom: 1px solid var(--watch-border-subtle)

        .text
            font-size: 0.85rem
            word-break: break-all
            // 白系のコメントは getCommentColor() が色を付けないので、ここのテーマ色が使われる
            color: var(--watch-fg)

    .empty
        color: var(--watch-fg-dim)

    .follow
        position: absolute
        left: 0
        right: 0
        bottom: 8px
        display: flex
        justify-content: center
</style>
