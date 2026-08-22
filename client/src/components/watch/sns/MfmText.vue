<template>
    <span class="mfm-text">
        <template v-for="(node, i) in nodes" v-bind:key="i">
            <strong v-if="node.type === 'bold'">{{ node.text }}</strong>
            <em v-else-if="node.type === 'italic'">{{ node.text }}</em>
            <s v-else-if="node.type === 'strike'">{{ node.text }}</s>
            <code v-else-if="node.type === 'code'" class="mfm-code">{{ node.text }}</code>
            <span v-else-if="node.type === 'fn'" class="mfm-fn" title="MFM 装飾 (この画面では見た目の再現はしません)">{{ node.text }}</span>
            <a v-else-if="node.type === 'url'" v-bind:href="node.text" target="_blank" rel="noopener noreferrer" class="mfm-url">{{ node.text }}</a>
            <span v-else-if="node.type === 'tag'" class="mfm-tag">{{ node.text }}</span>
            <span v-else-if="node.type === 'mention'" class="mfm-mention">{{ node.text }}</span>
            <img
                v-else-if="node.type === 'emoji' && emojiUrl(node.name) !== null"
                v-bind:src="emojiUrl(node.name) ?? undefined"
                v-bind:alt="`:${node.name}:`"
                v-bind:title="`:${node.name}:`"
                class="mfm-emoji"
            />
            <span v-else-if="node.type === 'emoji'">:{{ node.name }}:</span>
            <br v-else-if="node.type === 'break'" />
            <template v-else>{{ node.text }}</template>
        </template>
    </span>
</template>

<script lang="ts">
import { MfmNode } from '@/util/MfmRenderUtil';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';

/**
 * `MfmRenderUtil.parseMfm()` が返すノード配列を描画する。v-html は使わない。
 * カスタム絵文字 (`:name:`) の URL 解決は `emojiMap` (name -> 画像 URL) で行い、
 * 一覧に無い名前はテキストのまま `:name:` と表示する
 */
@Component({})
class MfmText extends Vue {
    @Prop({ required: true })
    public nodes!: MfmNode[];

    // カスタム絵文字名 -> 画像 URL。省略時は常にテキスト表示になる
    @Prop({ required: false, default: () => new Map() })
    public emojiMap!: Map<string, string>;

    public emojiUrl(name: string): string | null {
        return this.emojiMap.get(name) ?? null;
    }
}

export default toNative(MfmText);
</script>

<style lang="sass" scoped>
.mfm-text
    white-space: pre-wrap
    word-break: break-word

    .mfm-code
        background: rgba(128, 128, 128, 0.2)
        border-radius: 3px
        padding: 0 4px
        font-size: 0.9em

    .mfm-fn
        opacity: 0.85

    .mfm-url
        color: rgb(var(--v-theme-primary))
        word-break: break-all

    .mfm-tag,
    .mfm-mention
        color: rgb(var(--v-theme-primary))

    .mfm-emoji
        height: 1.25em
        width: auto
        vertical-align: middle
        object-fit: contain
</style>
