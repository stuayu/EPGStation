/**
 * しょぼいカレンダーのコメント (作品コメント / 放送回コメント) で使われている
 * Wiki 記法を解析するユーティリティ。
 *
 * しょぼいカレンダー独自の記法で、実データに現れるのは次の 6 種類:
 *   *見出し / **見出し        見出し (アスタリスクの数が階層)
 *   -項目 / --項目            箇条書き (ハイフンの数が階層)
 *   :項目名:内容              定義リスト (スタッフ・キャストの表記に多用される)
 *   !注記                     注記 (放送回コメントの「バレーボール中継延長のため繰り下げ」等)
 *   [[ラベル URL]]            リンク (ラベルと URL は半角スペース区切り)
 *   http://... https://...    裸の URL
 *
 * v-html を使わずに済むよう、HTML 文字列ではなく構造 (ブロックの配列) を返す。
 */

export type WikiInline = { type: 'text'; text: string } | { type: 'link'; text: string; href: string };

export type WikiBlock =
    | { type: 'heading'; level: number; children: WikiInline[] }
    | { type: 'list'; level: number; children: WikiInline[] }
    | { type: 'definition'; term: string; children: WikiInline[] }
    | { type: 'note'; children: WikiInline[] }
    | { type: 'paragraph'; children: WikiInline[] };

// [[ラベル URL]] 形式のリンク。ラベルを省いた [[URL]] も許容する
const LINK_PATTERN = /\[\[([^\]]+?)\]\]/g;
// 裸の URL (行末の句読点・閉じ括弧は URL に含めない)
const BARE_URL_PATTERN = /https?:\/\/[^\s<>"'”「」）)\]]+/g;

/**
 * リンクとして扱ってよい URL か (javascript: 等を弾く)
 * @param url: string
 * @return boolean
 */
const isSafeUrl = (url: string): boolean => {
    return /^https?:\/\//i.test(url);
};

/**
 * 裸の URL をリンクへ変換しつつ、テキストをインライン要素の配列にする
 * @param text: string
 * @return WikiInline[]
 */
const parseBareUrls = (text: string): WikiInline[] => {
    if (text === '') {
        return [];
    }

    const result: WikiInline[] = [];
    let lastIndex = 0;
    BARE_URL_PATTERN.lastIndex = 0;
    let matched: RegExpExecArray | null;
    while ((matched = BARE_URL_PATTERN.exec(text)) !== null) {
        if (matched.index > lastIndex) {
            result.push({ type: 'text', text: text.slice(lastIndex, matched.index) });
        }
        result.push({ type: 'link', text: matched[0], href: matched[0] });
        lastIndex = matched.index + matched[0].length;
    }
    if (lastIndex < text.length) {
        result.push({ type: 'text', text: text.slice(lastIndex) });
    }

    return result;
};

/**
 * 1 行分のテキストをインライン要素 (テキスト・リンク) の配列へ分解する
 * @param line: string
 * @return WikiInline[]
 */
export const parseInline = (line: string): WikiInline[] => {
    const result: WikiInline[] = [];
    let lastIndex = 0;
    LINK_PATTERN.lastIndex = 0;

    let matched: RegExpExecArray | null;
    while ((matched = LINK_PATTERN.exec(line)) !== null) {
        if (matched.index > lastIndex) {
            result.push(...parseBareUrls(line.slice(lastIndex, matched.index)));
        }

        const body = matched[1].trim();
        // 「ラベル URL」形式。URL は最後の空白より後ろにある
        const separator = body.lastIndexOf(' ');
        const url = separator < 0 ? body : body.slice(separator + 1);
        const label = separator < 0 ? body : body.slice(0, separator).trim();

        if (isSafeUrl(url) === true) {
            result.push({ type: 'link', text: label === '' ? url : label, href: url });
        } else {
            // URL を含まない [[...]] は記法ではなく本文なのでそのまま出す
            result.push(...parseBareUrls(body));
        }

        lastIndex = matched.index + matched[0].length;
    }

    if (lastIndex < line.length) {
        result.push(...parseBareUrls(line.slice(lastIndex)));
    }

    return result;
};

/**
 * しょぼいカレンダーのコメントをブロックの配列へ解析する
 * @param comment: string | null | undefined
 * @return WikiBlock[]
 */
export const parseSyobocalWiki = (comment: string | null | undefined): WikiBlock[] => {
    if (typeof comment !== 'string' || comment.trim() === '') {
        return [];
    }

    const blocks: WikiBlock[] = [];
    for (const rawLine of comment.replace(/\r\n?/g, '\n').split('\n')) {
        const line = rawLine.trimEnd();
        if (line.trim() === '') {
            continue;
        }

        const heading = /^(\*{1,3})(.*)$/.exec(line);
        if (heading !== null) {
            blocks.push({ type: 'heading', level: heading[1].length, children: parseInline(heading[2].trim()) });
            continue;
        }

        const definition = /^(:{1,2})([^:]*):(.*)$/.exec(line);
        if (definition !== null) {
            blocks.push({
                type: 'definition',
                term: definition[2].trim(),
                children: parseInline(definition[3].trim()),
            });
            continue;
        }

        const list = /^(-{1,3})(.*)$/.exec(line);
        if (list !== null) {
            blocks.push({ type: 'list', level: list[1].length, children: parseInline(list[2].trim()) });
            continue;
        }

        if (line.startsWith('!') === true) {
            blocks.push({ type: 'note', children: parseInline(line.slice(1).trim()) });
            continue;
        }

        blocks.push({ type: 'paragraph', children: parseInline(line.trim()) });
    }

    return blocks;
};

export default parseSyobocalWiki;
