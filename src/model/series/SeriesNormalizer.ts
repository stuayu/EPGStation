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
export function normalizeSeriesTitle(input: string): string {
    let value = input.normalize('NFKC').trim();
    while (LEADING_MARKERS.test(value)) value = value.replace(LEADING_MARKERS, '').trim();
    value = value.replace(/[【\[]?(?:再放送|再)[】\]]?/gu, ' ');
    value = value.replace(/(?:第\s*)?\d+(?:\.\d+)?\s*話.*$/u, ' ');
    value = value.replace(/[#＃]\s*\d+(?:\.\d+)?.*$/u, ' ');
    value = value.replace(/\b(?:ep(?:isode)?)[ ._-]*\d+(?:\.\d+)?.*$/iu, ' ');
    value = value.replace(/[「『].*?[」』]\s*$/u, ' ');
    return value
        .replace(/[\s\u3000]+/gu, ' ')
        .replace(/[・:：\-]+$/u, '')
        .trim()
        .toLocaleLowerCase('ja-JP');
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
    const airType: AirType = /(?:再放送|[【\[]再[】\]])/u.test(normalized)
        ? 'rerun'
        : /(?:遅れ|先行)/u.test(normalized)
          ? 'delayed'
          : 'unknown';
    return { normalizedTitle: normalizeSeriesTitle(input), seasonNumber, episodeNumber, episodeLabel, airType };
}
