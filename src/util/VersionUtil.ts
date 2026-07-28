/**
 * バージョン文字列の比較。
 * 本フォークのリリースタグは `2.14.0-stuayu-260727` のように
 * 「semver のベース + フォーク名 + 6 桁の日付 (YYMMDD)」という形をとる。
 * package.json の version は日付を持たない `2.14.0-stuayu` なので、
 * 単純な semver 比較では自分自身のリリースより常に古く見えてしまう。
 * ここではフォーク特有の日付サフィックスを別枠で扱ってその誤検出を防ぐ
 */

export interface ParsedVersion {
    // メジャー・マイナー・パッチ
    base: [number, number, number];
    // ベース以降の識別子 (日付サフィックスを除いたもの)。例: ['stuayu'] / ['rc', '1']
    pre: string[];
    // フォークのリリース日サフィックス (YYMMDD の 6 桁)。無ければ null
    date: number | null;
    // 解釈できた場合のみ true
    valid: boolean;
}

const NUMERIC = /^\d+$/;
// リリースタグ末尾に付く 6 桁の日付 (YYMMDD)
const DATE_SUFFIX = /^\d{6}$/;

/**
 * バージョン文字列を解析する。先頭の 'v' とビルドメタデータ (+xxx) は無視する
 * @param value: string
 * @return ParsedVersion
 */
export const parseVersion = (value: string): ParsedVersion => {
    const invalid: ParsedVersion = { base: [0, 0, 0], pre: [], date: null, valid: false };
    if (typeof value !== 'string') return invalid;

    // 'v2.14.0-stuayu-260727+build' → '2.14.0-stuayu-260727'
    const normalized = value.trim().replace(/^v/i, '').split('+')[0];
    if (normalized === '') return invalid;

    const [basePart, ...preParts] = normalized.split('-');
    const numbers = basePart.split('.');
    if (numbers.length < 1 || numbers.length > 3 || numbers.some(x => NUMERIC.test(x) === false)) return invalid;

    const base: [number, number, number] = [Number(numbers[0]), Number(numbers[1] ?? 0), Number(numbers[2] ?? 0)];

    // 識別子はドット区切りも許す (semver の 'rc.1' 形式)
    const identifiers = preParts
        .join('-')
        .split(/[-.]/)
        .filter(x => x !== '');
    // 末尾が 6 桁の数字ならフォークのリリース日として切り離す
    let date: number | null = null;
    if (identifiers.length > 0 && DATE_SUFFIX.test(identifiers[identifiers.length - 1])) {
        date = Number(identifiers.pop());
    }

    return { base, pre: identifiers, date, valid: true };
};

/**
 * プレリリース (rc / beta / alpha など) を表す識別子を含むか。
 * フォーク名だけの `-stuayu` は正式リリースとして扱う。
 * GitHub Release の prerelease フラグが取れる場合はそちらを優先すること
 * @param value: string
 * @return boolean
 */
export const isPrereleaseVersion = (value: string): boolean => {
    const parsed = parseVersion(value);
    if (parsed.valid === false) return false;
    return parsed.pre.some(x => /^(rc|beta|alpha|pre|dev|snapshot)$/i.test(x));
};

/**
 * semver に準じた識別子列の比較 (数値は数値として、文字列は辞書順で比べる)
 */
const comparePre = (a: string[], b: string[]): number => {
    // 識別子が無い側が「正式リリース」なので大きい
    if (a.length === 0 && b.length === 0) return 0;
    if (a.length === 0) return 1;
    if (b.length === 0) return -1;

    const length = Math.max(a.length, b.length);
    for (let i = 0; i < length; i++) {
        const x = a[i];
        const y = b[i];
        // 先に尽きた側が小さい
        if (typeof x === 'undefined') return -1;
        if (typeof y === 'undefined') return 1;
        if (x === y) continue;
        const xNum = NUMERIC.test(x);
        const yNum = NUMERIC.test(y);
        if (xNum && yNum) return Number(x) - Number(y) < 0 ? -1 : 1;
        // 数値の識別子は文字列の識別子より小さい (semver の規定)
        if (xNum !== yNum) return xNum ? -1 : 1;
        return x < y ? -1 : 1;
    }
    return 0;
};

/**
 * 2 つのバージョンを比較する
 * @param a: string
 * @param b: string
 * @return number a < b で負、a === b で 0、a > b で正
 */
export const compareVersions = (a: string, b: string): number => {
    const x = parseVersion(a);
    const y = parseVersion(b);
    // 解釈できないものは比較不能なので同値扱いにして「更新あり」と誤判定しないようにする
    if (x.valid === false || y.valid === false) return 0;

    for (let i = 0; i < 3; i++) {
        if (x.base[i] !== y.base[i]) return x.base[i] < y.base[i] ? -1 : 1;
    }

    const pre = comparePre(x.pre, y.pre);
    if (pre !== 0) return pre;

    // ベースも識別子も同じなら日付サフィックスで比べる。
    // 片方に日付が無い場合は「同じリリースの別表記」とみなして同値にする
    // (package.json の 2.14.0-stuayu と タグ 2.14.0-stuayu-260727 を別物にしないため)
    if (x.date === null || y.date === null) return 0;
    if (x.date === y.date) return 0;
    return x.date < y.date ? -1 : 1;
};

/**
 * latest が current より新しいか
 * @param current: string 現在のバージョン
 * @param latest: string 公開されているバージョン
 * @return boolean
 */
export const isNewerVersion = (current: string, latest: string): boolean => compareVersions(current, latest) < 0;
