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

test('login() は先頭の @ を除去して identifier を渡し、既定の PDS ホスト (bsky.social) を使う', async () => {
    const http = makeHttpStub((url, body) => {
        assert.equal(url, 'https://bsky.social/xrpc/com.atproto.server.createSession');
        const parsed = JSON.parse(body);
        assert.equal(parsed.identifier, 'user.bsky.social');
        return jsonResponse(200, { did: 'did:plc:abc', handle: 'user.bsky.social', accessJwt: 'a', refreshJwt: 'r' });
    });
    const client = new BlueskyClient(http);
    const session = await client.login('@user.bsky.social', 'app-pass');
    assert.equal(session.did, 'did:plc:abc');
    assert.equal(session.accessJwt, 'a');
});

test('login() は指定した service (PDS ホスト) を使う', async () => {
    const http = makeHttpStub(url => {
        assert.equal(url, 'https://pds.example.com/xrpc/com.atproto.server.createSession');
        return jsonResponse(200, { did: 'did:1', handle: 'h', accessJwt: 'a', refreshJwt: 'r' });
    });
    const client = new BlueskyClient(http);
    await client.login('user', 'pass', 'pds.example.com');
});

test('refresh() は Authorization ヘッダに refreshJwt を渡す', async () => {
    const http = makeHttpStub((url, _body, option) => {
        assert.equal(url, 'https://bsky.social/xrpc/com.atproto.server.refreshSession');
        assert.equal(option.headers.Authorization, 'Bearer refresh-token');
        return jsonResponse(200, { did: 'did:1', handle: 'h', accessJwt: 'new-a', refreshJwt: 'new-r' });
    });
    const client = new BlueskyClient(http);
    const session = await client.refresh('refresh-token');
    assert.equal(session.accessJwt, 'new-a');
});

test('getProfile() はプロフィール情報を変換する (displayName / avatar が無い場合は null)', async () => {
    const http = makeHttpStub(url => {
        assert.match(url, /app\.bsky\.actor\.getProfile\?actor=did%3Aplc%3Aabc/);
        return jsonResponse(200, { did: 'did:plc:abc', handle: 'user.bsky.social' });
    });
    const client = new BlueskyClient(http);
    const profile = await client.getProfile('token', 'did:plc:abc');
    assert.equal(profile.displayName, null);
    assert.equal(profile.avatarUrl, null);
});

test('createPost() は facets / embed を指定した場合だけ record に含める', async () => {
    const http = makeHttpStub((url, body) => {
        const parsed = JSON.parse(body);
        assert.equal(parsed.repo, 'did:plc:abc');
        assert.equal(parsed.record.text, 'hello');
        assert.equal('facets' in parsed.record, false);
        assert.equal('embed' in parsed.record, false);
        return jsonResponse(200, { uri: 'at://did:plc:abc/app.bsky.feed.post/xyz', cid: 'cid1' });
    });
    const client = new BlueskyClient(http);
    const result = await client.createPost('token', 'did:plc:abc', { text: 'hello', facets: [], images: [] });
    assert.equal(result.uri, 'at://did:plc:abc/app.bsky.feed.post/xyz');
});

test('createPost() は画像を渡すと embed.images を組み立てる', async () => {
    const http = makeHttpStub((_url, body) => {
        const parsed = JSON.parse(body);
        assert.equal(parsed.record.embed.$type, 'app.bsky.embed.images');
        assert.equal(parsed.record.embed.images.length, 1);
        return jsonResponse(200, { uri: 'at://x/app.bsky.feed.post/1', cid: 'c' });
    });
    const client = new BlueskyClient(http);
    await client.createPost('token', 'did:plc:abc', {
        text: '',
        facets: [],
        images: [{ blob: { $type: 'blob', ref: { $link: 'l' }, mimeType: 'image/jpeg', size: 1 }, alt: '' }],
    });
});

test('401 を受けると BlueskyApiError (status=401) を投げる', async () => {
    const http = makeHttpStub(() => ({
        status: 401,
        headers: new Map(),
        text: JSON.stringify({ error: 'ExpiredToken', message: 'Token has expired' }),
        json: () => ({ error: 'ExpiredToken', message: 'Token has expired' }),
    }));
    const client = new BlueskyClient(http);
    try {
        await client.getProfile('expired-token', 'did:plc:abc');
        assert.fail('should have thrown');
    } catch (e) {
        assert.ok(e instanceof BlueskyApiError);
        assert.equal(e.status, 401);
        assert.equal(e.detail, 'Token has expired');
    }
});

test('uploadBlob() はバイナリ body で fetch し、blob 参照を返す (IProviderHttpClient を使わず生 fetch)', async () => {
    const originalFetch = global.fetch;
    let capturedInit = null;
    global.fetch = async (url, init) => {
        capturedInit = init;
        assert.equal(url, 'https://bsky.social/xrpc/com.atproto.repo.uploadBlob');
        return {
            status: 200,
            text: async () =>
                JSON.stringify({ blob: { $type: 'blob', ref: { $link: 'bafy...' }, mimeType: 'image/jpeg', size: 3 } }),
        };
    };
    try {
        const client = new BlueskyClient(makeHttpStub(() => jsonResponse(200, {})));
        const blob = await client.uploadBlob('token', Buffer.from([1, 2, 3]), 'image/jpeg');
        assert.equal(blob.ref.$link, 'bafy...');
        assert.equal(capturedInit.headers['content-type'], 'image/jpeg');
        assert.equal(capturedInit.headers.Authorization, 'Bearer token');
    } finally {
        global.fetch = originalFetch;
    }
});

test('uploadBlob() は成功ステータスでも body に blob が無ければ BlueskyApiError を投げる', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({ status: 200, text: async () => JSON.stringify({}) });
    try {
        const client = new BlueskyClient(makeHttpStub(() => jsonResponse(200, {})));
        await assert.rejects(
            () => client.uploadBlob('token', Buffer.from([1]), 'image/jpeg'),
            e => e instanceof BlueskyApiError && /did not contain a blob/.test(e.message),
        );
    } finally {
        global.fetch = originalFetch;
    }
});

test('createPost() は成功ステータスでも uri/cid が欠けていれば BlueskyApiError を投げる', async () => {
    const http = makeHttpStub(() => jsonResponse(200, {}));
    const client = new BlueskyClient(http);
    await assert.rejects(
        () => client.createPost('token', 'did:plc:abc', { text: 'hi', facets: [], images: [] }),
        e => e instanceof BlueskyApiError && /did not contain uri\/cid/.test(e.message),
    );
});

test('login() は成功ステータスでも必須フィールドが欠けたセッション応答を拒否する', async () => {
    const http = makeHttpStub(() => jsonResponse(200, { did: 'did:1', handle: 'h' }));
    const client = new BlueskyClient(http);
    await assert.rejects(
        () => client.login('user', 'pass'),
        e => e instanceof BlueskyApiError && /missing required fields/.test(e.message),
    );
});
