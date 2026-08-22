<template>
    <div class="sns-mfm-picker">
        <v-text-field
            v-model="searchText"
            density="compact"
            hide-details
            clearable
            prepend-inner-icon="mdi-magnify"
            label="装飾を検索"
            autofocus
        ></v-text-field>

        <div class="list">
            <button v-for="d in filteredDecorations" v-bind:key="d.id" type="button" class="decoration-row" v-on:click="$emit('select', d)">
                <span class="decoration-label">{{ d.label }}</span>
                <span class="decoration-description text-caption">{{ d.description }}</span>
            </button>
        </div>

        <div v-if="filteredDecorations.length === 0" class="text-caption empty">該当する装飾がありません</div>
    </div>
</template>

<script lang="ts">
import { Component, Vue, toNative } from 'vue-facing-decorator';

/**
 * MFM 装飾 1 件分の定義。
 * `insert()` は「選択されていた本文 (無ければ placeholder)」を渡すと、
 * 記法で包んだ文字列全体を返す。呼び出し側は結果と `placeholder` からカーソル位置を計算する
 */
export interface MfmDecorationDef {
    id: string;
    label: string;
    description: string;
    prefix: string;
    suffix: string;
    placeholder: string;
}

// MFM 装飾の一覧。プレフィックス/サフィックスで本文 (または placeholder) を包む形で表現できるものに揃えている。
// 引用のみ行頭記法のため改行込みの prefix/suffix にしている
const DECORATIONS: MfmDecorationDef[] = [
    { id: 'bold', label: '太字', description: '**太字** のように強調します', prefix: '**', suffix: '**', placeholder: '太字' },
    { id: 'italic', label: '斜体', description: '*斜体* のように傾けます', prefix: '*', suffix: '*', placeholder: '斜体' },
    { id: 'strike', label: '打ち消し', description: '~~打ち消し線~~ を引きます', prefix: '~~', suffix: '~~', placeholder: '打ち消し' },
    { id: 'code', label: 'コード', description: '等幅フォントのコード表示にします', prefix: '`', suffix: '`', placeholder: 'コード' },
    { id: 'quote', label: '引用', description: '行頭に > を付けて引用として表示します', prefix: '\n> ', suffix: '\n', placeholder: '引用' },
    { id: 'small', label: '小さく', description: '文字を小さく表示します', prefix: '<small>', suffix: '</small>', placeholder: '小さく' },
    { id: 'x2', label: 'x2 (拡大)', description: '文字を 2 倍の大きさで表示します', prefix: '$[x2 ', suffix: ']', placeholder: '拡大' },
    { id: 'x3', label: 'x3 (拡大)', description: '文字を 3 倍の大きさで表示します', prefix: '$[x3 ', suffix: ']', placeholder: '拡大' },
    { id: 'x4', label: 'x4 (拡大)', description: '文字を 4 倍の大きさで表示します', prefix: '$[x4 ', suffix: ']', placeholder: '拡大' },
    { id: 'tada', label: 'tada', description: '飛び出すように拡大するアニメーションを付けます', prefix: '$[tada ', suffix: ']', placeholder: 'tada' },
    { id: 'jelly', label: 'jelly', description: 'ぷるぷる揺れるアニメーションを付けます', prefix: '$[jelly ', suffix: ']', placeholder: 'jelly' },
    { id: 'twitch', label: 'twitch', description: '小刻みに震えるアニメーションを付けます', prefix: '$[twitch ', suffix: ']', placeholder: 'twitch' },
    { id: 'shake', label: 'shake', description: '激しく震えるアニメーションを付けます', prefix: '$[shake ', suffix: ']', placeholder: 'shake' },
    { id: 'spin', label: 'spin', description: 'くるくる回転するアニメーションを付けます', prefix: '$[spin ', suffix: ']', placeholder: 'spin' },
    { id: 'jump', label: 'jump', description: '跳ねるアニメーションを付けます', prefix: '$[jump ', suffix: ']', placeholder: 'jump' },
    { id: 'bounce', label: 'bounce', description: '弾むアニメーションを付けます', prefix: '$[bounce ', suffix: ']', placeholder: 'bounce' },
    { id: 'rainbow', label: 'rainbow', description: '虹色に色が変化するアニメーションを付けます', prefix: '$[rainbow ', suffix: ']', placeholder: 'rainbow' },
    { id: 'sparkle', label: 'sparkle', description: 'きらきらと輝くエフェクトを付けます', prefix: '$[sparkle ', suffix: ']', placeholder: 'sparkle' },
    { id: 'flip', label: 'flip', description: '左右反転させます', prefix: '$[flip ', suffix: ']', placeholder: 'flip' },
    { id: 'rotate', label: 'rotate', description: '文字を回転させます', prefix: '$[rotate ', suffix: ']', placeholder: 'rotate' },
    { id: 'blur', label: 'blur', description: 'ぼかして表示し、押すと鮮明になります', prefix: '$[blur ', suffix: ']', placeholder: 'blur' },
    {
        id: 'font',
        label: 'font',
        description: 'フォントを明朝体 (serif) に変えます',
        prefix: '$[font.serif ',
        suffix: ']',
        placeholder: 'font',
    },
    { id: 'border', label: 'border', description: '文字を枠線で囲みます', prefix: '$[border ', suffix: ']', placeholder: 'border' },
    {
        id: 'position',
        label: 'position',
        description: '表示位置をずらします (x, y の数値は挿入後に編集してください)',
        prefix: '$[position.x=0,y=-0.5 ',
        suffix: ']',
        placeholder: 'position',
    },
    {
        id: 'scale',
        label: 'scale',
        description: '拡大縮小率を指定します (x, y の数値は挿入後に編集してください)',
        prefix: '$[scale.x=1.5,y=1.5 ',
        suffix: ']',
        placeholder: 'scale',
    },
    {
        id: 'fg',
        label: 'fg (文字色)',
        description: '文字色を指定します (color の値は挿入後に編集してください)',
        prefix: '$[fg.color=ff0000 ',
        suffix: ']',
        placeholder: '文字色',
    },
    {
        id: 'bg',
        label: 'bg (背景色)',
        description: '背景色を指定します (color の値は挿入後に編集してください)',
        prefix: '$[bg.color=ff0000 ',
        suffix: ']',
        placeholder: '背景色',
    },
];

/**
 * 投稿フォーム用の MFM 装飾ピッカー (表示のみ)。検索欄で label / description を絞り込める。
 * 選択時は `select` イベントで `MfmDecorationDef` を渡すだけで、textarea への実際の挿入は呼び出し側 (SnsPostPanel) が行う
 * (selectionStart / selectionEnd を扱うのは textarea の実体を持つ側の責務のため)
 */
@Component({})
class SnsMfmPicker extends Vue {
    public searchText: string = '';

    public get filteredDecorations(): MfmDecorationDef[] {
        const keyword = this.searchText.trim().toLowerCase();
        if (keyword === '') {
            return DECORATIONS;
        }

        return DECORATIONS.filter(d => d.label.toLowerCase().includes(keyword) === true || d.description.toLowerCase().includes(keyword) === true);
    }
}

export default toNative(SnsMfmPicker);
</script>

<style lang="sass" scoped>
.sns-mfm-picker
    display: flex
    flex-direction: column
    min-height: 0

    .list
        display: flex
        flex-direction: column
        margin-top: 8px
        overflow-y: auto

    .decoration-row
        display: flex
        flex-direction: column
        align-items: flex-start
        text-align: left
        width: 100%
        padding: 6px 8px
        border: none
        background: transparent
        border-radius: 4px
        cursor: pointer

        &:hover,
        &:focus-visible
            background: rgba(128, 128, 128, 0.2)

        .decoration-label
            font-weight: bold

        .decoration-description
            color: var(--watch-fg-dim)
            white-space: normal

    .empty
        color: var(--watch-fg-dim)
        margin-top: 8px
        text-align: center
</style>
