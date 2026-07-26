export type AirType = 'first' | 'rerun' | 'delayed' | 'unknown';
export interface SeriesParseResult {
    normalizedTitle: string;
    seasonNumber: number;
    episodeNumber: number | null;
    episodeLabel: string | null;
    airType: AirType;
}
const LEADING_MARKERS = /^(?:(?:[\[【<＜][^\]】>＞]{1,16}[\]】>＞])|(?:アニメ[Ａ-ＺA-Z]?・))+\s*/u;
const EPISODE_PATTERNS = [
    /(?:第\s*)?(\d+(?:\.\d+)?)\s*話/u,
    /[#＃]\s*(\d+(?:\.\d+)?)/u,
    /\b(?:ep(?:isode)?)[ ._-]*(\d+(?:\.\d+)?)/iu,
];
// 括弧で囲まれた語のみをマーカーとして除去する対象一覧 (裸の語は除去しない)
// 例: "(再)" "[新]" "【字】" は除去するが、"再婚承認を要求します" の「再」は除去しない
const BRACKET_MARKER_TOKEN =
    '(?:再放送|再|新|新作|終|終了|完|字幕?|デジタル|デ|吹替|二カ国語|二か国語|解説|多重音声|ステレオ|ノーカット|ドラマ|アニメ)';
const BRACKET_MARKERS = new RegExp(`[\\(\\[【<]\\s*${BRACKET_MARKER_TOKEN}\\s*[\\)\\]】>]`, 'gu');
// (再放送) / [再] / 【再】 のような「括弧で囲まれた再」表現を再放送判定に使う (裸の「再」は誤検知するため対象外)
const RERUN_PATTERN = /(?:再放送|[\(\[【]\s*再\s*[\)\]】])/u;

/**
 * 括弧で囲まれたノイズマーカー ((再)(新)(終)(字)(デ) 等) を除去する
 * 連続する複数マーカー (例: "(新)(終)") にも対応するため除去できなくなるまで繰り返す
 * @param value: string
 * @return string
 */
function removeBracketedMarkers(value: string): string {
    let result = value;
    for (;;) {
        const next = result.replace(BRACKET_MARKERS, ' ');
        if (next === result) return next;
        result = next;
    }
}

/**
 * 録画番組タイトルをシリーズ照合用に正規化する
 * NFKC 正規化 → 先頭ノイズ除去 → 括弧マーカー除去 → 話数/放送種別表記の除去 を行う
 * 除去しすぎて空文字になった場合は正規化前のタイトル (NFKC + trim のみ) にフォールバックする
 * @param input: string 録画番組タイトル
 * @return string 正規化済みタイトル (空にはならない、input が空文字でない限り)
 */
export function normalizeSeriesTitle(input: string): string {
    const original = input.normalize('NFKC').trim();
    let value = original;
    while (LEADING_MARKERS.test(value)) value = value.replace(LEADING_MARKERS, '').trim();
    value = removeBracketedMarkers(value);
    value = value.replace(/(?:第\s*)?\d+(?:\.\d+)?\s*話.*$/u, ' ');
    value = value.replace(/[#＃]\s*\d+(?:\.\d+)?.*$/u, ' ');
    value = value.replace(/\b(?:ep(?:isode)?)[ ._-]*\d+(?:\.\d+)?.*$/iu, ' ');
    value = value.replace(/[「『].*?[」』]\s*$/u, ' ');
    const cleaned = value
        .replace(/[\s\u3000]+/gu, ' ')
        .replace(/[・:：\-]+$/u, '')
        .trim();
    if (cleaned === '') {
        // 削りすぎて空になった場合は元タイトルへフォールバックする (提案書 §13.2)
        const fallback = original.replace(/[\s\u3000]+/gu, ' ').trim();
        return (fallback === '' ? original : fallback).toLocaleLowerCase('ja-JP');
    }
    return cleaned.toLocaleLowerCase('ja-JP');
}
export function parseSeriesInfo(input: string): SeriesParseResult {
    const normalized = input.normalize('NFKC');
    let episodeNumber: null | number = null;
    let episodeLabel: null | string = null;
    for (const pattern of EPISODE_PATTERNS) {
        const match = normalized.match(pattern);
        if (match) {
            episodeNumber = Number(match[1]);
            episodeLabel = match[0];
            break;
        }
    }
    const seasonMatch = normalized.match(/(?:第\s*(\d+)\s*期|season\s*(\d+)|s(\d+))/iu);
    const seasonNumber = Number(seasonMatch?.[1] ?? seasonMatch?.[2] ?? seasonMatch?.[3] ?? 1);
    const airType: AirType = RERUN_PATTERN.test(normalized)
        ? 'rerun'
        : /(?:遅れ|先行)/u.test(normalized)
          ? 'delayed'
          : 'unknown';
    return { normalizedTitle: normalizeSeriesTitle(input), seasonNumber, episodeNumber, episodeLabel, airType };
}
