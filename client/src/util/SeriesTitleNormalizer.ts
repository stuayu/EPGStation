/**
 * 番組表の「追いかけ中」インジケータ (§4.10) 用の簡易タイトル正規化
 *
 * サーバ側のシリーズ照合本体は src/model/series/SeriesNormalizer.ts (normalizeSeriesTitle) が正であり、
 * このファイルはあくまで番組表セル描画時にクライアント側だけで概算判定するための軽量な移植版。
 * サーバ側のロジックと完全には同期していないため、表示はベストエフォートのヒントに留め、
 * 正確な判定は各画面のシリーズ API 呼び出し結果を利用すること。
 * サーバ側の正規化アルゴリズムを変更した場合はこちらも追従を検討する。
 */
const LEADING_MARKERS = /^(?:(?:[[【<＜][^\]】>＞]{1,16}[\]】>＞])|(?:アニメ[Ａ-ＺA-Z]?・))+\s*/u;
const BRACKET_MARKER_TOKEN = '(?:再放送|再|新|新作|終|終了|完|字幕?|デジタル|デ|吹替|二カ国語|二か国語|解説|多重音声|ステレオ|ノーカット|ドラマ|アニメ)';
const BRACKET_MARKERS = new RegExp(`[\\(\\[【<]\\s*${BRACKET_MARKER_TOKEN}\\s*[\\)\\]】>]`, 'gu');

function removeBracketedMarkers(value: string): string {
    let result = value;
    for (;;) {
        const next = result.replace(BRACKET_MARKERS, ' ');
        if (next === result) return next;
        result = next;
    }
}

/**
 * 番組表インジケータ判定用にタイトルを正規化する (サーバの normalizeSeriesTitle の簡易移植)
 * @param input: string
 * @return string
 */
export function normalizeSeriesTitleForGuide(input: string): string {
    const original = input.normalize('NFKC').trim();
    let value = original;
    while (LEADING_MARKERS.test(value)) value = value.replace(LEADING_MARKERS, '').trim();
    value = removeBracketedMarkers(value);
    value = value.replace(/(?:第\s*)?\d+(?:\.\d+)?\s*話.*$/u, ' ');
    value = value.replace(/[#＃]\s*\d+(?:\.\d+)?.*$/u, ' ');
    value = value.replace(/\b(?:ep(?:isode)?)[ ._-]*\d+(?:\.\d+)?.*$/iu, ' ');
    value = value.replace(/[「『].*?[」』]\s*$/u, ' ');
    const cleaned = value
        .replace(/[\s　]+/gu, ' ')
        .replace(/[・:：\-]+$/u, '')
        .trim();
    if (cleaned === '') {
        const fallback = original.replace(/[\s　]+/gu, ' ').trim();
        return (fallback === '' ? original : fallback).toLocaleLowerCase('ja-JP');
    }
    return cleaned.toLocaleLowerCase('ja-JP');
}
