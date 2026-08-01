export type AirType = 'first' | 'rerun' | 'delayed' | 'unknown';
export interface SeriesParseResult {
    normalizedTitle: string;
    seasonNumber: number;
    episodeNumber: number | null;
    episodeLabel: string | null;
    airType: AirType;
    // 総集編・傑作選・一挙放送など「通し話数を持たない放送」と判定した場合 true。
    // タイトルに話数表記が無いときの逆引き (サブタイトル照合 / 放送予定照会) を抑止する
    isSpecial: boolean;
}
// 話数に使われる漢数字 (「第壱話」「漆話」など)
const KANJI_NUMERALS = '一二三四五六七八九十壱弐参肆伍陸漆捌玖拾百';
const KANJI_NUMERAL_VALUES: Readonly<Record<string, number>> = {
    一: 1,
    壱: 1,
    二: 2,
    弐: 2,
    三: 3,
    参: 3,
    四: 4,
    肆: 4,
    五: 5,
    伍: 5,
    六: 6,
    陸: 6,
    七: 7,
    漆: 7,
    八: 8,
    捌: 8,
    九: 9,
    玖: 9,
    十: 10,
    拾: 10,
};
// 話数として扱う助数詞。放送局によって「話」以外 (第1幕・第2旅 等) が使われる
const EPISODE_COUNTER = '(?:話|幕|旅|夜|章|回|羽|滑|品|球|杯)';
// 英字の話数表記 (Episode08 / Turn19 / break1 / days.1 / Mission:39 / request 1. / Part2 / vol.3 / No.5 など)
const EPISODE_WORD =
    '(?:ep|episode|turn|break|days?|mission|request|stage|case|act|file|track|scene|phase|round|step|lap|note|link|chapter|part|vol|volume|story|number|no)';
// 「番組名（17）」のように括弧だけで話数を表す表記 (NHK 系が使う)。
// 「(2024)」のような年号を話数と取り違えないよう、19xx / 20xx の 4 桁は除外する
const PARENTHESIZED_EPISODE = '[（(](?!(?:19|20)\\d{2}[)）])(\\d{1,4})[)）]';
const EPISODE_PATTERNS = [
    new RegExp(`(?:第\\s*)?(\\d+(?:\\.\\d+)?)\\s*${EPISODE_COUNTER}`, 'u'),
    new RegExp(`(?:第\\s*)?([${KANJI_NUMERALS}]+)\\s*${EPISODE_COUNTER}`, 'u'),
    /[#＃♯]\s*(\d+(?:\.\d+)?)/u,
    new RegExp(`\\b${EPISODE_WORD}[ .:_-]*(\\d+(?:\\.\\d+)?)`, 'iu'),
    // 「その1」「その二」形式 (助数詞を持たない和風の話数表記)
    /その\s*(\d+(?:\.\d+)?)/u,
    new RegExp(`その\\s*([${KANJI_NUMERALS}]+)(?![${KANJI_NUMERALS}])`, 'u'),
    // 他の表記で取れなかった場合の最後の候補 (括弧数字は年号・版数とも紛らわしいため優先度を最も低くする)
    new RegExp(PARENTHESIZED_EPISODE, 'u'),
];
// 総集編・一挙放送など、通し話数を持たない放送を表す語。
// SCRename の除外定義 (SCRename.exc) と同じ考え方で、話数の逆引きを抑止するために使う。
// 明示的な話数表記がタイトルにある場合はそちらを優先するため、ここでは判定のみ行う
const SPECIAL_PROGRAM_PATTERN =
    /(?:総集編|傑作選|振り?返り|ふりかえり|ダイジェスト|一挙(?:放送|配信)?|イッキ見|一気見|放送直前|直前(?:特番|スペシャル|SP)|完全版総集|特別編集版|名場面)/u;
// タイトル末尾から「話数表記以降」をまるごと落とすためのパターン (サブタイトルも一緒に落ちる)
const EPISODE_TAILS = [
    new RegExp(`(?:第\\s*)?\\d+(?:\\.\\d+)?\\s*${EPISODE_COUNTER}[\\s\\S]*$`, 'u'),
    new RegExp(`(?:第\\s*)?[${KANJI_NUMERALS}]+\\s*${EPISODE_COUNTER}[\\s\\S]*$`, 'u'),
    /[#＃♯]\s*\d+(?:\.\d+)?[\s\S]*$/u,
    new RegExp(`\\b${EPISODE_WORD}[ .:_-]*\\d+(?:\\.\\d+)?[\\s\\S]*$`, 'iu'),
    // 「作品名 （８）」「アオアシ（１７）」のような括弧付き話数 (前の空白は無くてもよい)
    new RegExp(`${PARENTHESIZED_EPISODE}[\\s\\S]*$`, 'u'),
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
        result = result
            .replace(BRACKET_MARKERS, ' ')
            .replace(/[\s\u3000]+/gu, ' ')
            .trim();
        while (leadingBlock.test(result)) result = result.replace(leadingBlock, '').trim();
        if (result === before) return result;
    }
}

// 先頭ブロック除去を行わないことを表す、決して一致しないパターン
const LEADING_BLOCK_NONE = /(?!)/u;

// 照合キーの最大長。作品辞書テーブルの lookupKey は索引付きの varchar(255) (MySQL) なので、
// これを超えるキーを作ると INSERT が ER_DATA_TOO_LONG で失敗する
export const MAX_LOOKUP_KEY_LENGTH = 255;

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
    if (
        quoted !== null &&
        (/アニメ|シリーズ|劇場版/u.test(quoted[1]) || (quoted[1].trim() === '' && quoted[2] === '『'))
    ) {
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
 *
 * 生成したキーは MAX_LOOKUP_KEY_LENGTH で必ず切り詰める。
 * 照合キーは DB 側が索引付きの varchar(255) (MySQL) なので、しょぼいカレンダーの
 * サブタイトルに稀に入る曲目リストのような長文がそのまま来ると INSERT が
 * ER_DATA_TOO_LONG で失敗し、辞書同期が丸ごと落ちる。
 * 書き込み側・照合側の両方がこの関数を通るため、切り詰めても両者のキーは一致する
 * @param input: string 任意のタイトル文字列
 * @return string 照合キー (記号のみのタイトルでは空文字になりうる)
 */
/**
 * LLM が抽出した作品名が、元のタイトルから導けるものか検証する。
 *
 * 抽出結果を作品辞書で引き直すだけでは「実在する別作品の名前を返した」場合に素通りしてしまう
 * (実データで「あそビバ」→「あそびにいくヨ!」、「TUF新春ロードショー」→「THE UNLIMITED -兵部京介-」
 *  のような誤りが出た)。照合キーの含有を要求すると、これらを落としつつ
 * 「装飾・話数・サブタイトルを取り除いただけ」の正しい抽出は通る
 * @param sourceTitle: string 元の録画/シリーズタイトル
 * @param extractedTitle: string LLM が抽出した作品名
 * @return boolean
 */
export function isDerivedFromTitle(sourceTitle: string, extractedTitle: string): boolean {
    const extracted = syobocalLookupKey(extractedTitle.normalize('NFKC'));
    if (extracted === '') return false;

    return syobocalLookupKey(sourceTitle.normalize('NFKC')).includes(extracted);
}

/**
 * 一般番組辞書 (Wikidata) 用の厳密な照合キー。
 *
 * syobocalLookupKey() は長音符・波ダッシュ・記号をすべて落とすため、
 * アニメ作品名では有効でも一般番組では別番組同士が衝突する
 * (実データで「あそビバ」と「あそビーバー」が同じキーになった)。
 * こちらは空白と一部の飾り記号だけを落とし、長音符・波ダッシュ・中黒は保持する
 * @param input: string
 * @return string
 */
export function strictProgramKey(input: string): string {
    const key = input
        .normalize('NFKC')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/gu, '')
        .normalize('NFC')
        .toLocaleLowerCase('ja-JP')
        // 空白と、表記ゆれの多い引用符・括弧・感嘆符類のみ除去する
        .replace(/[\s\u3000!?！？"'’‘”“「」『』【】]/gu, '')
        // 波ダッシュと全角チルダは同一視する (「サンドのぼんやり〜ぬTV」/「~ぬTV」)
        .replace(/[～〜~]/gu, '~');

    return key.length <= MAX_LOOKUP_KEY_LENGTH ? key : [...key].slice(0, MAX_LOOKUP_KEY_LENGTH).join('');
}

export function syobocalLookupKey(input: string): string {
    const key = input
        .normalize('NFKC')
        // ラテン文字の発音記号を落とす。分解 (NFD) したまま返すと日本語の濁点も
        // 分解形で残り比較がずれるため、除去後に必ず NFC へ戻す
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/gu, '')
        .normalize('NFC')
        .toLocaleLowerCase('ja-JP')
        .replace(/[\s\u3000!-/:-@[-`{-~、。・～〜ー―－‐’‘′”“「」『』【】]/gu, '');

    // サロゲートペアを割らないよう配列化してから切る
    return key.length <= MAX_LOOKUP_KEY_LENGTH ? key : [...key].slice(0, MAX_LOOKUP_KEY_LENGTH).join('');
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

/**
 * 括弧 (「」『』) で囲まれた部分を空白へ潰した文字列を返す。
 * サブタイトルは括弧の中に入ることが多く、その中の数字を話数と誤読しないための前処理に使う
 * (SCRename が話数走査を括弧の手前で打ち切るのと同じ考え方)
 */
function withoutQuotedParts(value: string): string {
    return value.replace(/[「『][^」』]*[」』]/gu, ' ');
}

/**
 * 話数表記を 1 件抽出する。EPISODE_PATTERNS を優先度順に試し、最初に数値化できたものを返す
 */
function matchEpisode(value: string): { episodeNumber: number; episodeLabel: string } | null {
    for (const pattern of EPISODE_PATTERNS) {
        const match = value.match(pattern);
        if (match === null) continue;
        const parsed = parseEpisodeNumber(match[1]);
        if (parsed === null) continue;
        return { episodeNumber: parsed, episodeLabel: match[0] };
    }
    return null;
}

export function parseSeriesInfo(input: string): SeriesParseResult {
    const normalized = input.normalize('NFKC');
    // 括弧の外 (= 作品名 + 話数表記が置かれる部分) を先に走査し、
    // 見つからない場合だけ「作品名 「#5 サブタイトル」」のような表記を救うため全文へフォールバックする
    const episode = matchEpisode(withoutQuotedParts(normalized)) ?? matchEpisode(normalized);
    const episodeNumber: null | number = episode?.episodeNumber ?? null;
    const episodeLabel: null | string = episode?.episodeLabel ?? null;
    const seasonMatch = normalized.match(
        /(?:第\s*(\d+)\s*期|(\d+)\s*期|season\s*(\d+)|(\d+)(?:nd|rd|th|st)\s*season|\bs(\d+)\b)/iu,
    );
    const seasonNumber = Number(
        seasonMatch?.[1] ?? seasonMatch?.[2] ?? seasonMatch?.[3] ?? seasonMatch?.[4] ?? seasonMatch?.[5] ?? 1,
    );
    const airType: AirType = RERUN_PATTERN.test(normalized)
        ? 'rerun'
        : /(?:遅れ|先行)/u.test(normalized)
          ? 'delayed'
          : 'unknown';
    return {
        normalizedTitle: normalizeSeriesTitle(input),
        seasonNumber,
        episodeNumber,
        episodeLabel,
        airType,
        isSpecial: SPECIAL_PROGRAM_PATTERN.test(normalized),
    };
}

// 照合キーの末尾に付く「期」の表記 (しょぼいカレンダーの正式タイトルは
// 「株式会社マジルミエ(第2期)」「よふかしのうた(第2期)」のように期を括弧書きで持つ)。
// syobocalLookupKey は記号を落とすため、ここでは記号が無い状態を前提に照合する
const SEASON_SUFFIX_IN_KEY =
    /(?:第?\d+期|第?[一二三四五六七八九十]+期|シーズン\d+|season\d+|\d+(?:st|nd|rd|th)season|パート\d+|part\d+|final(?:season)?)$/u;

/**
 * 照合キーから末尾の「期」表記を落として基本キーにする。
 * 「株式会社マジルミエ第2期」→「株式会社マジルミエ」のように、同じ作品の続編どうしを
 * 1 つのグループへまとめるために使う (WorkDictionary が放送時期から期を選び直す)
 * @param lookupKey: string syobocalLookupKey() で作った照合キー
 * @return string 期表記を落とした基本キー (落とすものが無ければそのまま)
 */
export function seasonBaseKey(lookupKey: string): string {
    let key = lookupKey;
    // 「(第2期)」のように複数の表記が重なることは無いが、末尾の空要素を残さないよう繰り返し落とす
    for (let i = 0; i < 2; i++) {
        const stripped = key.replace(SEASON_SUFFIX_IN_KEY, '');
        if (stripped === key || stripped.length < 2) break;
        key = stripped;
    }

    return key;
}
