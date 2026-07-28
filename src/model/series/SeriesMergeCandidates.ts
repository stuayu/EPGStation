/**
 * マージ候補の絞り込み・並べ替え。
 * 誤って作られたシリーズは正しいシリーズのタイトルに副題や話数が付いた形 (またはその逆) になることが多いため、
 * 正規化タイトルの前方一致を主軸に候補を並べる
 */

/**
 * 候補の一致種別。
 * 'exact': 正規化タイトルが完全一致 / 'prefix': 候補が対象タイトルで始まる (候補のほうが長い) /
 * 'contained': 対象が候補タイトルで始まる (対象のほうが長い) / 'partial': 先頭の一部だけ一致
 */
export type SeriesMergeMatchType = 'exact' | 'prefix' | 'contained' | 'partial';

export interface MergeCandidateSource {
    id: number;
    normalizedTitle: string;
}

export interface RankedMergeCandidate<T extends MergeCandidateSource> {
    item: T;
    matchType: SeriesMergeMatchType;
    // 正規化タイトルの共通接頭辞の文字数
    commonPrefixLength: number;
}

export interface RankMergeCandidatesOption {
    // 候補として残す共通接頭辞の最小文字数 (既定 2)
    minCommonPrefixLength?: number;
    // 返す最大件数 (既定 30)
    limit?: number;
}

const MATCH_TYPE_RANK: Record<SeriesMergeMatchType, number> = {
    exact: 0,
    prefix: 1,
    contained: 2,
    partial: 3,
};

/**
 * 2 つの文字列の共通接頭辞の文字数を返す
 * @param a: string
 * @param b: string
 * @return number
 */
export const commonPrefixLength = (a: string, b: string): number => {
    const max = Math.min(a.length, b.length);
    let i = 0;
    while (i < max && a[i] === b[i]) i++;
    return i;
};

/**
 * 対象シリーズに対するマージ候補を前方一致でスコアリングして並べ替える
 * @param target: MergeCandidateSource マージ元 (統合される側) のシリーズ
 * @param candidates: T[] 候補シリーズ群 (対象自身が含まれていても除外する)
 * @param option?: RankMergeCandidatesOption
 * @return RankedMergeCandidate<T>[] 一致度の高い順
 */
export const rankMergeCandidates = <T extends MergeCandidateSource>(
    target: MergeCandidateSource,
    candidates: T[],
    option?: RankMergeCandidatesOption,
): RankedMergeCandidate<T>[] => {
    const minLength = option?.minCommonPrefixLength ?? 2;
    const limit = option?.limit ?? 30;
    const targetTitle = target.normalizedTitle;
    if (targetTitle === '') return [];

    const result: RankedMergeCandidate<T>[] = [];
    for (const item of candidates) {
        if (item.id === target.id) continue;
        const title = item.normalizedTitle;
        if (title === '') continue;
        const length = commonPrefixLength(targetTitle, title);
        // 1 文字しか共通しない組は候補として意味を持たないため落とす。
        // ただし片方が 1 文字タイトルの場合はその完全一致を拾えるようにする
        if (length < Math.min(minLength, targetTitle.length, title.length)) continue;
        if (length === 0) continue;
        let matchType: SeriesMergeMatchType;
        if (title === targetTitle) matchType = 'exact';
        else if (title.startsWith(targetTitle)) matchType = 'prefix';
        else if (targetTitle.startsWith(title)) matchType = 'contained';
        else matchType = 'partial';
        result.push({ item, matchType, commonPrefixLength: length });
    }

    result.sort((a, b) => {
        const rank = MATCH_TYPE_RANK[a.matchType] - MATCH_TYPE_RANK[b.matchType];
        if (rank !== 0) return rank;
        if (a.commonPrefixLength !== b.commonPrefixLength) return b.commonPrefixLength - a.commonPrefixLength;
        return a.item.id - b.item.id;
    });
    return result.slice(0, limit);
};
