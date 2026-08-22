/**
 * Bluesky (AT Protocol) の投稿本文から URL / ハッシュタグの facets を組み立てる純粋関数。
 * KonomiTV `server/app/utils/BlueskyAPI.py:1050-1105` (`_buildTextBuilder`) の移植。
 *
 * AT Protocol の facet はテキストの UTF-8 バイトオフセット (byteStart / byteEnd) で
 * 範囲を指定する。JS の文字列インデックス (UTF-16 コードユニット) をそのまま使うと
 * 絵文字・日本語の混在で必ずずれるため、`Buffer.byteLength()` で都度算出する
 */

export interface BlueskyFacetIndex {
    byteStart: number;
    byteEnd: number;
}

export interface BlueskyLinkFacet {
    index: BlueskyFacetIndex;
    features: [{ $type: 'app.bsky.richtext.facet#link'; uri: string }];
}

export interface BlueskyTagFacet {
    index: BlueskyFacetIndex;
    features: [{ $type: 'app.bsky.richtext.facet#tag'; tag: string }];
}

export type BlueskyFacet = BlueskyLinkFacet | BlueskyTagFacet;

namespace BlueskyFacetUtil {
    // URL / タグの末尾に張り付きがちな句読点・閉じ括弧の集合。
    // これらは facet の範囲から外し、本文側 (facet 無し) へ押し戻す
    export const URL_TRAILING_PUNCTUATIONS = '。、,.;:!?！？)）」』]>';
    // https:// / http:// の URL、または #tag / ＃tag を拾うトークナイザ
    export const TOKEN_PATTERN = /(https?:\/\/[^\s]+)|([#＃]([^\s#＃]+))/g;
}

/**
 * 末尾の句読点・閉じ括弧を取り除く
 * @param token: string
 * @return string 取り除いた後のトークン
 */
const stripTrailingPunctuation = (token: string): string => {
    let result = token;
    while (result.length > 0 && BlueskyFacetUtil.URL_TRAILING_PUNCTUATIONS.includes(result[result.length - 1])) {
        result = result.slice(0, -1);
    }

    return result;
};

/**
 * 投稿本文から Bluesky の facets (URL リンク / ハッシュタグ) を組み立てる。
 * 本文の文字列そのものは書き換えない (facets はあくまで既存本文への範囲指定)
 * @param text: string 投稿本文
 * @return BlueskyFacet[]
 */
export const buildBlueskyFacets = (text: string): BlueskyFacet[] => {
    const facets: BlueskyFacet[] = [];
    const pattern = new RegExp(BlueskyFacetUtil.TOKEN_PATTERN);
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
        const matchStart = match.index;
        const isUrl = typeof match[1] !== 'undefined';
        const tokenText = stripTrailingPunctuation(match[0]);
        if (tokenText.length === 0) continue;

        const charStart = matchStart;
        const charEnd = matchStart + tokenText.length;
        const byteStart = Buffer.byteLength(text.slice(0, charStart), 'utf8');
        const byteEnd = Buffer.byteLength(text.slice(0, charEnd), 'utf8');

        if (isUrl) {
            facets.push({
                index: { byteStart, byteEnd },
                features: [{ $type: 'app.bsky.richtext.facet#link', uri: tokenText }],
            });
        } else {
            // 先頭の # / ＃ を 1 文字だけ除いたものが facet の tag 値になる
            // (トークナイザの character class が # / ＃ をこれ以上含まないため、先頭 1 文字のみでよい)
            const tagText = tokenText.slice(1);
            if (tagText.length > 0) {
                facets.push({
                    index: { byteStart, byteEnd },
                    features: [{ $type: 'app.bsky.richtext.facet#tag', tag: tagText }],
                });
            }
        }
    }

    return facets;
};

export default BlueskyFacetUtil;
