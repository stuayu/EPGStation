<template>
    <span class="wiki-inline">
        <template v-for="(node, i) in children" :key="i">
            <a v-if="node.type === 'link'" :href="node.href" target="_blank" rel="noopener noreferrer" class="wiki-link">
                {{ node.text }}
                <v-icon size="x-small">mdi-open-in-new</v-icon>
            </a>
            <span v-else>{{ node.text }}</span>
        </template>
    </span>
</template>

<script lang="ts">
import { WikiInline } from '@/util/SyobocalWiki';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';

/**
 * Wiki 記法の 1 行分 (テキストとリンクの混在) を描画する。
 * v-html を使わずに済ませるため、解析済みの構造を受け取って描画のみ行う
 */
@Component({})
class WikiInlineText extends Vue {
    @Prop({ required: true })
    public children!: WikiInline[];
}

export default toNative(WikiInlineText);
</script>

<style lang="sass" scoped>
.wiki-link
    color: rgb(var(--v-theme-primary))
    text-decoration: none

    &:hover
        text-decoration: underline
</style>
