<template>
    <div class="watch-panel-comments">
        <div ref="list" class="list" v-on:scroll="onScroll">
            <div v-for="(comment, index) in comments" :key="index" class="comment">
                <div class="text" v-bind:style="{ color: getCommentColor(comment) }">{{ comment.text }}</div>
            </div>
            <div v-if="comments.length === 0" class="empty text-body-2">コメントはまだありません</div>
        </div>
        <div v-if="isFollowing === false" class="follow">
            <v-btn size="small" variant="tonal" v-on:click="scrollToBottom">最新のコメントへ</v-btn>
        </div>
    </div>
</template>

<script lang="ts">
import { JikkyoComment } from '@/util/JikkyoCommentClient';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';

/**
 * 右パネルの「コメント」タブの中身
 * 映像に流れている実況コメントを時系列で並べる
 */
@Component({})
class WatchPanelComments extends Vue {
    @Prop({ required: true })
    public comments!: JikkyoComment[];

    // ライトモードで背景に埋もれてしまう白系の指定色
    private static readonly WHITE_COLORS = ['#fff', '#ffffff', 'white', 'rgb(255, 255, 255)'];

    /**
     * 一番下に追従しているか (自分でスクロールを上げている間は自動追従しない)
     */
    public isFollowing: boolean = true;

    public mounted(): void {
        this.scrollToBottom();
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
