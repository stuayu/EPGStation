'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    convertBlueskyFeedViewPostToTimelineNote,
    buildBlueskyPostUrl,
    parseBlueskyAtUri,
} = require('../../dist/model/sns/BlueskyTimelineConverter');

const basePost = (override = {}) => ({
    uri: 'at://did:plc:abc/app.bsky.feed.post/xyz',
    cid: 'cid1',
    author: { did: 'did:plc:abc', handle: 'user.bsky.social', displayName: 'User', avatar: 'https://x/a.png' },
    record: { text: 'hello', createdAt: '2026-08-01T00:00:00.000Z' },
    likeCount: 2,
    repostCount: 1,
    viewer: {},
    ...override,
});

test('parseBlueskyAtUri() は repo (did) と rkey を取り出す', () => {
    const parsed = parseBlueskyAtUri('at://did:plc:abc/app.bsky.feed.post/xyz');
    assert.deepEqual(parsed, { repo: 'did:plc:abc', rkey: 'xyz' });
});

test('parseBlueskyAtUri() は不正な形式で null を返す', () => {
    assert.equal(parseBlueskyAtUri('not-an-at-uri'), null);
});

test('buildBlueskyPostUrl() は did をそのまま使った bsky.app のパーマリンクを組み立てる', () => {
    assert.equal(
        buildBlueskyPostUrl('at://did:plc:abc/app.bsky.feed.post/xyz'),
        'https://bsky.app/profile/did:plc:abc/post/xyz',
    );
});

test('通常の投稿を共通形へ変換する (cw は常に null)', () => {
    const result = convertBlueskyFeedViewPostToTimelineNote({ post: basePost() });
    assert.equal(result.id, 'at://did:plc:abc/app.bsky.feed.post/xyz');
    assert.equal(result.cid, 'cid1');
    assert.equal(result.text, 'hello');
    assert.equal(result.cw, null);
    assert.equal(result.author.handle, 'user.bsky.social');
    assert.equal(result.url, 'https://bsky.app/profile/did:plc:abc/post/xyz');
});

test('like は 1 件の reactions として詰められ、viewer.like の有無で isMine が決まる', () => {
    const liked = convertBlueskyFeedViewPostToTimelineNote({ post: basePost({ viewer: { like: 'at://x/app.bsky.feed.like/1' } }) });
    assert.equal(liked.reactions.length, 1);
    assert.equal(liked.reactions[0].name, '❤');
    assert.equal(liked.reactions[0].count, 2);
    assert.equal(liked.reactions[0].isMine, true);

    const notLiked = convertBlueskyFeedViewPostToTimelineNote({ post: basePost({ viewer: {} }) });
    assert.equal(notLiked.reactions[0].isMine, false);
});

test('renoteCount / isRenotedByMe は repostCount / viewer.repost から決まる', () => {
    const reposted = convertBlueskyFeedViewPostToTimelineNote({ post: basePost({ viewer: { repost: 'at://x/app.bsky.feed.repost/1' } }) });
    assert.equal(reposted.renoteCount, 1);
    assert.equal(reposted.isRenotedByMe, true);
});

test('images embed から画像一覧を取り出す', () => {
    const result = convertBlueskyFeedViewPostToTimelineNote({
        post: basePost({
            embed: {
                $type: 'app.bsky.embed.images#view',
                images: [{ thumb: 'https://x/thumb.jpg', fullsize: 'https://x/full.jpg', alt: '' }],
            },
        }),
    });
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].url, 'https://x/full.jpg');
    assert.equal(result.images[0].thumbnailUrl, 'https://x/thumb.jpg');
});

test('recordWithMedia embed でも media 側から画像を取り出す', () => {
    const result = convertBlueskyFeedViewPostToTimelineNote({
        post: basePost({
            embed: {
                $type: 'app.bsky.embed.recordWithMedia#view',
                media: {
                    $type: 'app.bsky.embed.images#view',
                    images: [{ thumb: 'https://x/thumb.jpg', fullsize: 'https://x/full.jpg' }],
                },
            },
        }),
    });
    assert.equal(result.images.length, 1);
});

test('labels があると画像はすべてセンシティブ扱いになる', () => {
    const result = convertBlueskyFeedViewPostToTimelineNote({
        post: basePost({
            labels: [{ val: 'porn' }],
            embed: { $type: 'app.bsky.embed.images#view', images: [{ thumb: 't', fullsize: 'f' }] },
        }),
    });
    assert.equal(result.images[0].isSensitive, true);
});

test('embed が無ければ images は空配列になる', () => {
    const result = convertBlueskyFeedViewPostToTimelineNote({ post: basePost() });
    assert.deepEqual(result.images, []);
});
