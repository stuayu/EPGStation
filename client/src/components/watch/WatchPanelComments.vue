<template>
    <div class="watch-panel-comments">
        <div ref="list" class="list" v-on:scroll="onScroll">
            <div v-for="(comment, index) in comments" :key="index" class="comment">
                <div class="text" v-bind:style="{ color: comment.color }">{{ comment.text }}</div>
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
        border-bottom: 1px solid rgba(255, 255, 255, 0.06)

        .text
            font-size: 0.85rem
            word-break: break-all

    .empty
        color: rgba(255, 255, 255, 0.5)

    .follow
        position: absolute
        left: 0
        right: 0
        bottom: 8px
        display: flex
        justify-content: center
</style>
