<template>
    <div v-if="blocks.length > 0" class="syobocal-comment">
        <div class="comment-body" :class="{ 'is-collapsed': isCollapsed === true }">
            <template v-for="(block, i) in blocks" :key="i">
                <div v-if="block.type === 'heading'" class="wiki-heading" :class="`level-${block.level}`">
                    <WikiInlineText :children="block.children"></WikiInlineText>
                </div>
                <div v-else-if="block.type === 'definition'" class="wiki-definition">
                    <span class="term">{{ block.term }}</span>
                    <span class="value"><WikiInlineText :children="block.children"></WikiInlineText></span>
                </div>
                <div v-else-if="block.type === 'list'" class="wiki-list" :class="`level-${block.level}`">
                    <span class="bullet">・</span>
                    <span class="value"><WikiInlineText :children="block.children"></WikiInlineText></span>
                </div>
                <div v-else-if="block.type === 'note'" class="wiki-note">
                    <v-icon size="x-small" class="mr-1">mdi-alert-circle-outline</v-icon>
                    <WikiInlineText :children="block.children"></WikiInlineText>
                </div>
                <div v-else class="wiki-paragraph">
                    <WikiInlineText :children="block.children"></WikiInlineText>
                </div>
            </template>
        </div>
        <v-btn v-if="collapsible === true && isCollapsible === true" variant="text" size="small" @click="isCollapsed = !isCollapsed">
            {{ isCollapsed === true ? 'もっと見る' : '折りたたむ' }}
        </v-btn>
    </div>
</template>

<script lang="ts">
import { parseSyobocalWiki, WikiBlock } from '@/util/SyobocalWiki';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';
import WikiInlineText from './WikiInlineText.vue';

/**
 * しょぼいカレンダー由来のコメントを Wiki 記法として整形して表示する。
 * 記法をそのまま出すと「*リンク」「:監督:○○」のような生テキストが並ぶため、
 * 見出し・箇条書き・定義リスト・リンクとして描画する。
 * 手動編集されたコメントも同じ記法で書けるため区別せず同じ描画を通す
 */
@Component({ components: { WikiInlineText } })
class SyobocalComment extends Vue {
    @Prop({ required: false, default: null })
    public comment!: string | null;

    // 長文の作品コメント向け。既定で折りたたみ、「もっと見る」で全文を出す
    @Prop({ required: false, default: false })
    public collapsible!: boolean;

    public isCollapsed: boolean = true;

    get blocks(): WikiBlock[] {
        return parseSyobocalWiki(this.comment);
    }

    /**
     * 折りたたむ意味がある長さか (数行しかないコメントにボタンを出さない)
     */
    get isCollapsible(): boolean {
        return this.blocks.length > SyobocalComment.COLLAPSE_THRESHOLD_BLOCKS;
    }

    private static readonly COLLAPSE_THRESHOLD_BLOCKS = 5;

    @Watch('comment')
    public onCommentChange(): void {
        this.isCollapsed = true;
    }

    public created(): void {
        this.isCollapsed = this.collapsible;
    }
}

export default toNative(SyobocalComment);
</script>

<style lang="sass" scoped>
.syobocal-comment
    .comment-body
        word-break: break-word

        &.is-collapsed
            max-height: 10em
            overflow: hidden
            // 折りたたみ中は末尾をフェードさせて続きがあることを示す
            mask-image: linear-gradient(to bottom, black 60%, transparent 100%)

    .wiki-heading
        font-weight: bold
        margin-top: 0.75em
        margin-bottom: 0.25em

        &.level-1
            font-size: 1rem

        &.level-2
            font-size: 0.9375rem
            opacity: 0.9

        &.level-3
            font-size: 0.875rem
            opacity: 0.8

        &:first-child
            margin-top: 0

    .wiki-definition
        display: flex
        flex-wrap: wrap
        gap: 0 0.5em
        font-size: 0.875rem
        line-height: 1.6

        .term
            flex: 0 0 auto
            opacity: 0.7

            &::after
                content: ':'

        .value
            flex: 1 1 auto
            min-width: 0

    .wiki-list
        display: flex
        font-size: 0.875rem
        line-height: 1.6

        &.level-2
            padding-left: 1em

        &.level-3
            padding-left: 2em

        .bullet
            flex: 0 0 auto
            opacity: 0.6

        .value
            flex: 1 1 auto
            min-width: 0

    .wiki-note
        font-size: 0.875rem
        line-height: 1.6
        opacity: 0.85

    .wiki-paragraph
        font-size: 0.875rem
        line-height: 1.6
        white-space: pre-wrap
</style>
