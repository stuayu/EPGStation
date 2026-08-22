'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const BlueskyClient = require('../../dist/model/sns/BlueskyClient').default;
const { BlueskyApiError } = require('../../dist/model/sns/IBlueskyClient');

function makeHttpStub(responder) {
    const calls = [];
    return {
        calls,
        async get(url, option) {
            calls.push({ method: 'GET', url, option });
            return responder(url, undefined, option);
        },
        async post(url, body, option) {
            calls.push({ method: 'POST', url, body, option });
            return responder(url, body, option);
        },
    };
}

const jsonResponse = (status, body) => ({
    status,
    headers: new Map(),
    text: JSON.stringify(body),
    json: () => body,
});

test('getTimeline() は limit / cursor をクエリへ載せ、Authorization ヘッダを付ける', async () => {
    const http = makeHttpStub((url, _body, option) => {
        const parsed = new URL(url);
        assert.equal(parsed.pathname, '/xrpc/app.bsky.feed.getTimeline');
        assert.equal(parsed.searchParams.get('limit'), '10');
        assert.equal(parsed.searchParams.get('cursor'), 'cur1');
        assert.equal(option.headers.Authorization, 'Bearer token');
        return jsonResponse(200, { feed: [{ post: { uri: 'at://x/app.bsky.feed.post/1', cid: 'c' } }], cursor: 'next' });
    });
    const client = new BlueskyClient(http);
    const result = await client.getTimeline('token', { limit: 10, cursor: 'cur1' });
    assert.equal(result.feed.length, 1);
    assert.equal(result.cursor, 'next');
});

test('getTimeline() は limit を 1〜50 にクランプする', async () => {
    const http = makeHttpStub(url => {
        assert.equal(new URL(url).searchParams.get('limit'), '50');
        return jsonResponse(200, { feed: [] });
    });
    const client = new BlueskyClient(http);
    await client.getTimeline('token', { limit: 999 });
});

test('getTimeline() は feed が無ければ空配列を返す', async () => {
    const http = makeHttpStub(() => jsonResponse(200, {}));
    const client = new BlueskyClient(http);
    const result = await client.getTimeline('token', {});
    assert.deepEqual(result.feed, []);
});

test('like() は app.bsky.feed.like で createRecord し、作成された at-uri を返す', async () => {
    const http = makeHttpStub((url, body) => {
        assert.equal(url, 'https://bsky.social/xrpc/com.atproto.repo.createRecord');
        const parsed = JSON.parse(body);
        assert.equal(parsed.collection, 'app.bsky.feed.like');
        assert.equal(parsed.record.subject.uri, 'at://x/app.bsky.feed.post/1');
        assert.equal(parsed.record.subject.cid, 'cid1');
        return jsonResponse(200, { uri: 'at://did:plc:abc/app.bsky.feed.like/likekey1' });
    });
    const client = new BlueskyClient(http);
    const result = await client.like('token', 'did:plc:abc', 'at://x/app.bsky.feed.post/1', 'cid1');
    assert.equal(result.uri, 'at://did:plc:abc/app.bsky.feed.like/likekey1');
});

test('deleteLike() は app.bsky.feed.like + rkey で deleteRecord する', async () => {
    const http = makeHttpStub((url, body) => {
        assert.equal(url, 'https://bsky.social/xrpc/com.atproto.repo.deleteRecord');
        assert.deepEqual(JSON.parse(body), { repo: 'did:plc:abc', collection: 'app.bsky.feed.like', rkey: 'likekey1' });
        return jsonResponse(200, {});
    });
    const client = new BlueskyClient(http);
    await client.deleteLike('token', 'did:plc:abc', 'likekey1');
});

test('repost() は app.bsky.feed.repost で createRecord する', async () => {
    const http = makeHttpStub((_url, body) => {
        const parsed = JSON.parse(body);
        assert.equal(parsed.collection, 'app.bsky.feed.repost');
        return jsonResponse(200, { uri: 'at://did:plc:abc/app.bsky.feed.repost/rp1' });
    });
    const client = new BlueskyClient(http);
    const result = await client.repost('token', 'did:plc:abc', 'at://x/app.bsky.feed.post/1', 'cid1');
    assert.equal(result.uri, 'at://did:plc:abc/app.bsky.feed.repost/rp1');
});

test('deleteRepost() は app.bsky.feed.repost + rkey で deleteRecord する', async () => {
    const http = makeHttpStub((_url, body) => {
        const parsed = JSON.parse(body);
        assert.equal(parsed.collection, 'app.bsky.feed.repost');
        assert.equal(parsed.rkey, 'rp1');
        return jsonResponse(200, {});
    });
    const client = new BlueskyClient(http);
    await client.deleteRepost('token', 'did:plc:abc', 'rp1');
});

test('like() は成功ステータスでも uri が無ければ BlueskyApiError を投げる', async () => {
    const http = makeHttpStub(() => jsonResponse(200, {}));
    const client = new BlueskyClient(http);
    await assert.rejects(
        () => client.like('token', 'did:1', 'at://x/app.bsky.feed.post/1', 'c'),
        e => e instanceof BlueskyApiError && /did not contain uri/.test(e.message),
    );
});

test('deleteLike() は 401 で BlueskyApiError (status=401) を投げる', async () => {
    const http = makeHttpStub(() => ({
        status: 401,
        headers: new Map(),
        text: '',
        json: () => ({ error: 'ExpiredToken', message: 'expired' }),
    }));
    const client = new BlueskyClient(http);
    await assert.rejects(
        () => client.deleteLike('token', 'did:1', 'rkey'),
        e => e instanceof BlueskyApiError && e.status === 401,
    );
});
