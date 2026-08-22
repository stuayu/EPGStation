import * as apid from '../../../api';
import { BlueskyFeedViewPost, BlueskyTimelineImageView, BlueskyTimelinePostEmbed } from './IBlueskyClient';

namespace BlueskyTimelineConverter {
    // at://<repo>/<collection>/<rkey>
    export const AT_URI_PATTERN = /^at:\/\/([^/]+)\/[^/]+\/([^/]+)$/;
}

/**
 * at-uri から repo (did) と rkey を取り出す
 * @param uri: string
 * @return { repo: string; rkey: string } | null
 */
export const parseBlueskyAtUri = (uri: string): { repo: string; rkey: string } | null => {
    const match = BlueskyTimelineConverter.AT_URI_PATTERN.exec(uri);
    if (match === null) return null;

    return { repo: match[1], rkey: match[2] };
};

/**
 * 投稿の at-uri から bsky.app のパーマリンクを組み立てる。
 * repo 部分はハンドルでなく DID でも bsky.app は解決できるため、そのまま使う
 * @param uri: string
 * @return string | null
 */
export const buildBlueskyPostUrl = (uri: string): string | null => {
    const parsed = parseBlueskyAtUri(uri);
    if (parsed === null) return null;

    return `https://bsky.app/profile/${parsed.repo}/post/${parsed.rkey}`;
};

/**
 * embed (画像 embed / recordWithMedia embed) から画像一覧を取り出す
 * @param embed: BlueskyTimelinePostEmbed | undefined
 * @return BlueskyTimelineImageView[]
 */
const extractImages = (embed: BlueskyTimelinePostEmbed | undefined): BlueskyTimelineImageView[] => {
    if (typeof embed === 'undefined') return [];
    if (Array.isArray(embed.images)) return embed.images;
    if (typeof embed.media !== 'undefined') return extractImages(embed.media);

    return [];
};

/**
 * Bluesky のタイムライン投稿を共通形 (`SnsTimelineNote`) へ変換する。
 * **割り切り**:
 * - CW に相当する機能が無いため `cw` は常に null
 * - センシティブ判定は `labels` の有無だけで見る (個別ラベル種別は区別しない)
 * - リアクションは like を 1 件だけ詰める (`name: '❤'`)
 * @param item: BlueskyFeedViewPost
 * @return apid.SnsTimelineNote
 */
export const convertBlueskyFeedViewPostToTimelineNote = (item: BlueskyFeedViewPost): apid.SnsTimelineNote => {
    const post = item.post;
    const images = extractImages(post.embed);
    const isSensitive = Array.isArray(post.labels) && post.labels.length > 0;
    const createdAtSource = post.record?.createdAt ?? post.indexedAt;
    const createdAt = typeof createdAtSource === 'string' ? Date.parse(createdAtSource) : Date.now();

    return {
        id: post.uri,
        cid: post.cid,
        createdAt: Number.isNaN(createdAt) ? Date.now() : createdAt,
        text: post.record?.text ?? '',
        cw: null,
        author: {
            id: post.author.did,
            handle: post.author.handle,
            displayName: post.author.displayName ?? post.author.handle,
            avatarUrl: post.author.avatar ?? null,
        },
        images: images.map(image => ({
            url: image.fullsize ?? image.thumb ?? '',
            thumbnailUrl: image.thumb ?? null,
            isSensitive,
        })),
        reactions: [
            {
                name: '❤',
                count: post.likeCount ?? 0,
                url: null,
                isMine: typeof post.viewer?.like === 'string',
            },
        ],
        renoteCount: post.repostCount ?? 0,
        isRenotedByMe: typeof post.viewer?.repost === 'string',
        url: buildBlueskyPostUrl(post.uri),
    };
};
