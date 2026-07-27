export type AirType = 'first' | 'rerun' | 'delayed' | 'unknown';
export interface SeriesParseResult {
    normalizedTitle: string;
    seasonNumber: number;
    episodeNumber: number | null;
    episodeLabel: string | null;
    airType: AirType;
}
// 話数に使われる漢数字 (「第壱話」「漆話」など)
const KANJI_NUMERALS = '一二三四五六七八九十壱弐参肆伍陸漆捌玖拾百';
const KANJI_NUMERAL_VALUES: Readonly<Record<string, number>> = {
    一: 1, 壱: 1, 二: 2, 弐: 2, 三: 3, 参: 3, 四: 4, 肆: 4, 五: 5, 伍: 5,
    六: 6, 陸: 6, 七: 7, 漆: 7, 八: 8, 捌: 8, 九: 9, 玖: 9, 十: 10, 拾: 10,
};
// 話数として扱う助数詞。放送局によって「話」以外 (第1幕・第2旅 等) が使われる
const EPISODE_COUNTER = '(?:話|幕|旅|夜|章|回|羽|滑|品|球|杯)';
// 英字の話数表記 (Episode08 / Turn19 / break1 / days.1 / Mission:39 / request 1. など)
const EPISODE_WORD =
    '(?:ep|episode|turn|break|days?|mission|request|stage|case|act|file|track|scene|phase|round|step|lap|note|link|chapter)';
const EPISODE_PATTERNS = [
    new RegExp(`(?:第\\s*)?(\\d+(?:\\.\\d+)?)\\s*${EPISODE_COUNTER}`, 'u'),
    new RegExp(`(?:第\\s*)?([${KANJI_NUMERALS}]+)\\s*${EPISODE_COUNTER}`, 'u'),
    /[#＃♯]\s*(\d+(?:\.\d+)?)/u,
    new RegExp(`\\b${EPISODE_WORD}[ .:_-]*(\\d+(?:\\.\\d+)?)`, 'iu'),
];
// タイトル末尾から「話数表記以降」をまるごと落とすためのパターン (サブタイトルも一緒に落ちる)
const EPISODE_TAILS = [
    new RegExp(`(?:第\\s*)?\\d+(?:\\.\\d+)?\\s*${EPISODE_COUNTER}[\\s\\S]*$`, 'u'),
    new RegExp(`(?:第\\s*)?[${KANJI_NUMERALS}]+\\s*${EPISODE_COUNTER}[\\s\\S]*$`, 'u'),
    /[#＃♯]\s*\d+(?:\.\d+)?[\s\S]*$/u,
    new RegExp(`\\b${EPISODE_WORD}[ .:_-]*\\d+(?:\\.\\d+)?[\\s\\S]*$`, 'iu'),
    // 「作品名 （８）」のような括弧付き話数
    /\s[（(]\s*\d+\s*[)）][\s\S]*$/u,
];
// 括弧で囲まれた語のみをマーカーとして除去する対象一覧 (裸の語は除去しない)
// 例: "(再)" "[新]" "【字】" は除去するが、"再婚承認を要求します" の「再」は除去しない
const BRACKET_MARKER_TOKEN =
    '(?:再放送|再|新|新作|終|終了|完|字幕?|デジタル|デ|吹替|二カ国語|二か国語|解説|解|多重音声|ステレオ|ノーカット|ドラマ|アニメ|SS?|無)';
const BRACKET_MARKERS = new RegExp(`[\\(\\[【<]\\s*${BRACKET_MARKER_TOKEN}\\s*[\\)\\]】>]`, 'giu');
// (再放送) / [再] / 【再】 のような「括弧で囲まれた再」表現を再放送判定に使う (裸の「再」は誤検知するため対象外)
const RERUN_PATTERN = /(?:再放送|[\(\[【]\s*再\s*[\)\]】])/u;
// 先頭の角括弧ブロック ([字] 【新】 <アニおび> など)
const LEADING_BRACKET = '[\\[【<＜][^\\]】>＞]{1,16}[\\]】>＞]';
// 「アニメ」を含む編成枠の冠。
// 区切りは「・」「空白」のほか、直後が括弧の場合 (例: "水曜アニメ<水もん>" "テレビアニメ「作品名」") も許す。
// 枠名自体に空白を含むもの ("SEIBU TRAIN アニメスペシャル・") を拾うため、アニメの前は空白を含んでよい
const LEADING_ANIME_FRAME = '[^・\\[【<]{0,16}アニメ[^\\s\\u3000・\\[【<「『]{0,8}(?:[・\\s\\u3000]|(?=[\\[【<「『]))';
// 先頭の編成ブロック名。[字] のような角括弧ブロックと「アニメ」「TVアニメ」「水曜アニメ・」等を除去する
const LEADING_BLOCK_STRICT = new RegExp(`^(?:${LEADING_BRACKET}|${LEADING_ANIME_FRAME})+\\s*`, 'u');
// STRICT に加えて「メディアβ・」「＋Ultra・」のような "短い語 + ・" の冠も除去する。
// 「ライアー・ライアー」のような作品名を削ってしまう恐れがあるため、STRICT で辞書に当たらなかった場合の
// 第 2 候補としてのみ使う (buildSeriesLookupKeys 参照)
const LEADING_BLOCK_LOOSE = new RegExp(
    `^(?:${LEADING_BRACKET}|${LEADING_ANIME_FRAME}|[^\\s\\u3000・]{1,12}・(?=\\S))+\\s*`,
    'u',
);
// 末尾に付く枠名ブロック・サブタイトル。
// (HDマスター版) のような丸括弧は版の違いを表し作品の区別に使えるため、ここでは除去しない
const TRAILING_BLOCKS = [/【[^】]{0,40}】\s*$/u, /[「『][^」』]*[」』]\s*$/u];
// 括弧で囲まれずタイトル末尾に付く放送枠名。局が枠名を作品名に連結して送出するため、
// これを残すと同一作品が枠ごとに別シリーズへ分裂する
// (例: "薬屋のひとりごと FRIDAY ANIME NIGHT" と "薬屋のひとりごと")
const TRAILING_FRAME_NAMES =
    /[\s\u3000](?:FRIDAY ANIME NIGHT|ANiMAZiNG!*|ANIME NIGHT|アニメシャワー|スーパーアニメイズム(?:TURBO)?|アニメイズム|ノイタミナ|アガルアニメ|MANPA|日5|日曜劇場)[\s\u3000]*$/iu;
// 「TVアニメ『作品名』2nd Season」のように作品名が括弧で囲まれている表記。
// 前置きが枠名 (アニメ/シリーズ/劇場版) の場合と、二重かぎ括弧 (『』) で始まる場合のみ展開する。
// 「」だけで始まるものはサブタイトル単体 (例: 「サブタイトル」) の可能性が高いため展開しない
const QUOTED_TITLE = /^(.{0,12}?)([「『])([^」』]{2,})[」』]([\s\S]*)$/u;

/**
 * 括弧で囲まれたノイズマーカー ((再)(新)(終)(字)(デ) 等) と先頭の編成ブロック名を除去する
 * 連続する複数マーカー (例: "(新)(終)") にも対応するため除去できなくなるまで繰り返す
 */
function removeMarkers(value: string, leadingBlock: RegExp): string {
    let result = value;
    for (;;) {
        const before = result;
        result = result.replace(BRACKET_MARKERS, ' ').replace(/[\s\u3000]+/gu, ' ').trim();
        while (leadingBlock.test(result)) result = result.replace(leadingBlock, '').trim();
        if (result === before) return result;
    }
}

// 先頭ブロック除去を行わないことを表す、決して一致しないパターン
const LEADING_BLOCK_NONE = /(?!)/u;

/**
 * 録画番組タイトルから先頭ノイズ・括弧マーカー・話数/放送種別表記・末尾サブタイトルを除去する (大文字小文字は保持)
 * NFKC 正規化 → マーカー除去 → 話数表記以降の除去 → 括弧付き作品名の展開 → 末尾ブロック除去 を行う
 *
 * 先頭ブロックを除去すると何も残らなくなる場合 (例: 「アニメA 第1話」の「アニメA」は編成ブロック名ではなく
 * 作品名そのもの) は、先頭ブロック除去なしでやり直す。それでも空なら元タイトルへフォールバックする
 * @param input: string 録画番組タイトル
 * @param leadingBlock: RegExp 先頭ブロック除去に使うパターン (省略時は誤削除の少ない STRICT)
 * @return string クリーニング済みタイトル (空にはならない、input が空文字でない限り)
 */
function cleanSeriesTitle(input: string, leadingBlock: RegExp = LEADING_BLOCK_STRICT): string {
    const cleaned = cleanWithLeadingBlock(input, leadingBlock);
    if (cleaned !== '') return cleaned;
    const withoutLeadingBlock = cleanWithLeadingBlock(input, LEADING_BLOCK_NONE);
    if (withoutLeadingBlock !== '') return withoutLeadingBlock;
    // 削りすぎて空になった場合は元タイトルへフォールバックする (提案書 §13.2)
    const original = input.normalize('NFKC').trim();
    const fallback = original.replace(/[\s\u3000]+/gu, ' ').trim();
    return fallback === '' ? original : fallback;
}

/**
 * cleanSeriesTitle() の 1 パス分。削りすぎて何も残らなかった場合は空文字を返す
 */
function cleanWithLeadingBlock(input: string, leadingBlock: RegExp): string {
    const original = input.normalize('NFKC').trim();
    let value = removeMarkers(original, leadingBlock);
    for (const pattern of EPISODE_TAILS) value = value.replace(pattern, ' ').trim();

    // 「TVアニメ『作品名』」形式なら括弧の中身を作品名として採用する。
    // 前置きが空か枠名の場合に限定し、「作品名 「サブタイトル」」を誤って展開しないようにする
    const quoted = value.match(QUOTED_TITLE);
    if (quoted !== null && (/アニメ|シリーズ|劇場版/u.test(quoted[1]) || (quoted[1].trim() === '' && quoted[2] === '『'))) {
        value = `${quoted[3]} ${quoted[4]}`.trim();
    }

    // 末尾の枠名ブロック・枠名・サブタイトルを落とす (全部落ちて空になる場合はその除去を行わない)
    for (;;) {
        const before = value;
        for (const pattern of [...TRAILING_BLOCKS, TRAILING_FRAME_NAMES]) {
            const next = value.replace(pattern, ' ').trim();
            if (next !== '') value = next;
        }
        if (value === before) break;
    }

    return value
        .replace(/[\s\u3000]+/gu, ' ')
        .replace(/[・:：\-〜~★☆▼▽◆◇♪＊*＋+]+$/u, '')
        .trim();
}

/**
 * 録画番組タイトルをシリーズ照合用に正規化する
 * cleanSeriesTitle() の結果を小文字化したもの。照合キー専用であり、表示名には displaySeriesTitle() を使うこと
 * @param input: string 録画番組タイトル
 * @return string 正規化済みタイトル (空にはならない、input が空文字でない限り)
 */
export function normalizeSeriesTitle(input: string): string {
    return cleanSeriesTitle(input).toLocaleLowerCase('ja-JP');
}

/**
 * 新規シリーズの表示名として使うタイトルを生成する
 * normalizeSeriesTitle() と同じクリーニングを行うが、大文字小文字を保持するため表示に適する
 * @param input: string 録画番組タイトル
 * @return string 表示用シリーズタイトル
 */
export function displaySeriesTitle(input: string): string {
    return cleanSeriesTitle(input);
}

/**
 * 作品辞書との突き合わせに使う照合キーを生成する。
 * 記号・空白・長音/ダッシュ/引用符の表記ゆれをすべて落とし、小文字化した「骨格だけ」の文字列を返す
 * ("ざつ旅-That's Journey-" と "ざつ旅―that’s journey―" が同じキーになる)。
 * ラテン文字の発音記号も畳むため "Übel Blatt" と "Ubel Blatt" が一致する
 * (日本語の濁点・半濁点は U+3099/U+309A で下記の範囲外なので影響しない)
 * @param input: string 任意のタイトル文字列
 * @return string 照合キー (記号のみのタイトルでは空文字になりうる)
 */
export function syobocalLookupKey(input: string): string {
    return input
        .normalize('NFKC')
        // ラテン文字の発音記号を落とす。分解 (NFD) したまま返すと日本語の濁点も
        // 分解形で残り比較がずれるため、除去後に必ず NFC へ戻す
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/gu, '')
        .normalize('NFC')
        .toLocaleLowerCase('ja-JP')
        .replace(/[\s\u3000!-/:-@[-`{-~、。・～〜ー―－‐’‘′”“「」『』【】]/gu, '');
}

// タイトル中で 「」/『』 に囲まれた作品名。
// 局が「枠名 + 「作品名」」の形で送出することがあり (例: 日5「ウィッチウォッチ」、
// 映画「五等分の花嫁」、『はたらく細胞』実写映画公開記念)、この場合は括弧の中だけが作品名になる
const EMBEDDED_QUOTED_TITLE = /(.*?)[「『]([^」』]{2,})[」』]/u;
// ただし括弧の直前が実写ドラマを示す語の場合は作品名として採らない。
// 同名のアニメ作品へ誤って寄せてしまうため (例: 実写ドラマ「gift」がアニメ「Gift ～ギフト～」に一致した)
const NON_ANIME_QUOTE_PREFIX = /(?:ドラマ|主演|実写)[^「『]{0,8}$/u;
// タイトル末尾に付く読み仮名の括弧 (例: 羅小黒戦記(ロシャオヘイセンキ))
const TRAILING_READING = /[（(][^）)]{1,30}[）)]\s*$/u;

/**
 * 録画番組タイトルから、作品辞書を引くための照合キー候補を優先度順に返す。
 * 先に挙げた候補ほど確度が高く、呼び出し側は当たるまで順に辞書を引く。
 *
 *  1. 先頭ブロック除去 (STRICT) — 誤削除の少ない既定の解釈
 *  2. 先頭ブロック除去 (LOOSE)  — "メディアβ・ぼさにまる" のような "短い語 + ・" の冠にも対応
 *     (1 を先に試すので "ライアー・ライアー" のような作品名は削られない)
 *  3. 末尾の読み仮名括弧を除いた形 — "羅小黒戦記(ロシャオヘイセンキ)"
 *  4. 括弧内の作品名のみ — "日5「ウィッチウォッチ」" のように枠名と作品名が併記される形。
 *     サブタイトルを誤って作品名と解釈しうるため、他の候補がすべて外れた場合の最終手段とする
 * @param input: string 録画番組タイトル
 * @return string[] 重複を除いた照合キー候補 (先頭ほど確度が高い)
 */
export function buildSeriesLookupKeys(input: string): string[] {
    const keys: string[] = [];
    const push = (value: string): void => {
        const key = syobocalLookupKey(value);
        if (key !== '' && keys.includes(key) === false) keys.push(key);
    };

    const cleaned: string[] = [];
    for (const leadingBlock of [LEADING_BLOCK_STRICT, LEADING_BLOCK_LOOSE]) {
        const value = cleanSeriesTitle(input, leadingBlock);
        cleaned.push(value);
        push(value);
    }
    for (const value of cleaned) {
        const withoutReading = value.replace(TRAILING_READING, '').trim();
        if (withoutReading !== '') push(withoutReading);
    }
    const quoted = input.normalize('NFKC').match(EMBEDDED_QUOTED_TITLE);
    if (quoted !== null && NON_ANIME_QUOTE_PREFIX.test(quoted[1]) === false) {
        const title = quoted[2].trim();
        push(title);
        const withoutReading = title.replace(TRAILING_READING, '').trim();
        if (withoutReading !== '') push(withoutReading);
    }
    return keys;
}

/**
 * 漢数字混じりの話数表記を数値へ変換する ("壱" → 1, "十二" → 12)。十進の位取りは十・拾のみ扱う
 */
function parseEpisodeNumber(value: string): number | null {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;

    let total = 0;
    let current = 0;
    for (const char of value) {
        const digit = KANJI_NUMERAL_VALUES[char];
        if (typeof digit === 'undefined') return null;
        if (digit === 10) {
            total += (current === 0 ? 1 : current) * 10;
            current = 0;
        } else if (char === '百') {
            total += (current === 0 ? 1 : current) * 100;
            current = 0;
        } else {
            current = digit;
        }
    }
    const result = total + current;
    return result > 0 ? result : null;
}

export function parseSeriesInfo(input: string): SeriesParseResult {
    const normalized = input.normalize('NFKC');
    let episodeNumber: null | number = null;
    let episodeLabel: null | string = null;
    for (const pattern of EPISODE_PATTERNS) {
        const match = normalized.match(pattern);
        if (match) {
            const parsed = parseEpisodeNumber(match[1]);
            if (parsed === null) continue;
            episodeNumber = parsed;
            episodeLabel = match[0];
            break;
        }
    }
    const seasonMatch = normalized.match(/(?:第\s*(\d+)\s*期|(\d+)\s*期|season\s*(\d+)|(\d+)(?:nd|rd|th|st)\s*season|\bs(\d+)\b)/iu);
    const seasonNumber = Number(
        seasonMatch?.[1] ?? seasonMatch?.[2] ?? seasonMatch?.[3] ?? seasonMatch?.[4] ?? seasonMatch?.[5] ?? 1,
    );
    const airType: AirType = RERUN_PATTERN.test(normalized)
        ? 'rerun'
        : /(?:遅れ|先行)/u.test(normalized)
          ? 'delayed'
          : 'unknown';
    return { normalizedTitle: normalizeSeriesTitle(input), seasonNumber, episodeNumber, episodeLabel, airType };
}
