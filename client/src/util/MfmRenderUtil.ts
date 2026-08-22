/**
 * Misskey の MFM (Markup language For Misskey) 記法とカスタム絵文字表記を解析するユーティリティ。
 *
 * `mfm-js` (公式パーサ) は新規依存として追加しない方針のため、必要最小限の記法だけを扱う
 * 軽量な自前パーサをここに実装する。`client/src/util/SyobocalWiki.ts` (しょぼいカレンダーの
 * Wiki 記法パーサ) と同じ考え方: v-html を使わずに済むよう、HTML 文字列ではなく構造
 * (ノードの配列) を返す。扱わない記法は記法自体を剥がしてプレーンテキストとして出す
 * (壊れた見た目で表示されるより、読める方を優先する)。
 *
 * 対応する記法:
 *   :emoji_name: / :emoji_name@host:   カスタム絵文字 (URL 解決は描画側でインスタンスの絵文字一覧を突き合わせて行う)
 *   **太字**                            太字
 *   *斜体* / _斜体_                     斜体
 *   ~~打ち消し~~                        打ち消し線
 *   `コード`                            インラインコード
 *   $[fn.opt=x 中身]                    MFM 関数構文。中身だけをテキストとして出す (アニメーション再現はしない)
 *   http(s)://...                       URL
 *   #タグ                               ハッシュタグ
 *   @user@host / @user                  メンション
 *   改行                                 改行として保持する
 */

export type MfmNode =
    | { type: 'text'; text: string }
    | { type: 'bold'; text: string }
    | { type: 'italic'; text: string }
    | { type: 'strike'; text: string }
    | { type: 'code'; text: string }
    // MFM 関数構文の中身。アニメーション等の再現はせず、テキストとしてのみ出す
    | { type: 'fn'; text: string }
    | { type: 'emoji'; name: string }
    | { type: 'url'; text: string }
    | { type: 'tag'; text: string }
    | { type: 'mention'; text: string }
    | { type: 'break' };

// 各記法をまとめて 1 回の scan で検出するためのトークンパターン。
// 前方から順に alternation を試すため、より限定的 (誤爆しやすい) な記法ほど手前に置く
const TOKEN_PATTERN =
    /(:[a-zA-Z0-9_+\-@.]+:)|(\*\*[^\n]+?\*\*)|(~~[^\n]+?~~)|(`[^`\n]+?`)|(\*[^\n*]+?\*)|(_[^\n_]+?_)|(\$\[[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_.,=\-]+)? [^\]\n]*\])|(https?:\/\/[^\s<>"'”「」（）()\[\]]+)|(#[^\s#.,!?、。！？「」『』()（）]+)|(@[a-zA-Z0-9_.\-]+(?:@[a-zA-Z0-9.\-]+)?)|(\n)/g;

/**
 * MFM 関数構文 `$[name.opt=x 中身]` から中身だけを取り出す
 * @param token: string
 * @return string
 */
const extractFnContent = (token: string): string => {
    const spaceIndex = token.indexOf(' ');
    if (spaceIndex < 0) {
        return '';
    }

    return token.slice(spaceIndex + 1, token.length - 1);
};

/**
 * MFM 記法・カスタム絵文字表記を含むテキストをノードの配列へ解析する。
 * 未対応の記法は記法を剥がしてプレーンテキストとして返す (純粋関数)
 * @param text: string | null | undefined
 * @return MfmNode[]
 */
export const parseMfm = (text: string | null | undefined): MfmNode[] => {
    if (typeof text !== 'string' || text === '') {
        return [];
    }

    const nodes: MfmNode[] = [];
    let plainBuffer = '';

    const flushPlain = (): void => {
        if (plainBuffer !== '') {
            nodes.push({ type: 'text', text: plainBuffer });
            plainBuffer = '';
        }
    };

    let lastIndex = 0;
    TOKEN_PATTERN.lastIndex = 0;
    let matched: RegExpExecArray | null;

    while ((matched = TOKEN_PATTERN.exec(text)) !== null) {
        if (matched.index > lastIndex) {
            plainBuffer += text.slice(lastIndex, matched.index);
        }

        const token = matched[0];
        if (token.startsWith(':') === true && token.endsWith(':') === true) {
            flushPlain();
            nodes.push({ type: 'emoji', name: token.slice(1, -1) });
        } else if (token.startsWith('**') === true) {
            flushPlain();
            nodes.push({ type: 'bold', text: token.slice(2, -2) });
        } else if (token.startsWith('~~') === true) {
            flushPlain();
            nodes.push({ type: 'strike', text: token.slice(2, -2) });
        } else if (token.startsWith('`') === true) {
            flushPlain();
            nodes.push({ type: 'code', text: token.slice(1, -1) });
        } else if (token.startsWith('*') === true) {
            flushPlain();
            nodes.push({ type: 'italic', text: token.slice(1, -1) });
        } else if (token.startsWith('_') === true) {
            flushPlain();
            nodes.push({ type: 'italic', text: token.slice(1, -1) });
        } else if (token.startsWith('$[') === true) {
            flushPlain();
            const content = extractFnContent(token);
            if (content !== '') {
                nodes.push({ type: 'fn', text: content });
            }
        } else if (token.startsWith('http://') === true || token.startsWith('https://') === true) {
            flushPlain();
            nodes.push({ type: 'url', text: token });
        } else if (token.startsWith('#') === true) {
            flushPlain();
            nodes.push({ type: 'tag', text: token });
        } else if (token.startsWith('@') === true) {
            flushPlain();
            nodes.push({ type: 'mention', text: token });
        } else if (token === '\n') {
            flushPlain();
            nodes.push({ type: 'break' });
        } else {
            // 未知のトークン (理論上到達しない) はテキストとして扱う
            plainBuffer += token;
        }

        lastIndex = matched.index + token.length;
    }

    if (lastIndex < text.length) {
        plainBuffer += text.slice(lastIndex);
    }
    flushPlain();

    return nodes;
};

export default parseMfm;
