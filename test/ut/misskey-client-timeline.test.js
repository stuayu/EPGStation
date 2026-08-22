'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const MisskeyClient = require('../../dist/model/sns/MisskeyClient').default;

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

// ------------------------------------------------------------------
// getEmojis (キャッシュ TTL)
// ------------------------------------------------------------------

test('getEmojis() は /api/emojis を認証なしで叩き、結果を変換する', async () => {
    const http = makeHttpStub(url => {
        assert.equal(url, 'https://misskey.io/api/emojis');
        return jsonResponse(200, {
            emojis: [{ name: 'party', url: 'https://x/party.png', category: 'General', aliases: ['tada'] }],
        });
    });
    const client = new MisskeyClient(http);
    const emojis = await client.getEmojis('misskey.io');
    assert.deepEqual(emojis, [{ name: 'party', url: 'https://x/party.png', category: 'General', aliases: ['tada'] }]);
    assert.equal(http.calls[0].method, 'GET');
});

test('getEmojis() は TTL 内なら 2 回目以降 http を叩かない (host ごとにキャッシュする)', async () => {
    let callCount = 0;
    const http = makeHttpStub(() => {
        callCount += 1;
        return jsonResponse(200, { emojis: [{ name: 'a', url: 'https://x/a.png', category: null, aliases: [] }] });
    });
    const client = new MisskeyClient(http);
    const now = 1_000_000;
    await client.getEmojis('misskey.io', now);
    await client.getEmojis('misskey.io', now + 1000);
    assert.equal(callCount, 1);
});

test('getEmojis() は TTL (1 時間) を超えると再取得する', async () => {
    let callCount = 0;
    const http = makeHttpStub(() => {
        callCount += 1;
        return jsonResponse(200, { emojis: [] });
    });
    const client = new MisskeyClient(http);
    const now = 1_000_000;
    await client.getEmojis('misskey.io', now);
    await client.getEmojis('misskey.io', now + 60 * 60 * 1000 + 1);
    assert.equal(callCount, 2);
});

test('getEmojis() は host ごとに別々にキャッシュする', async () => {
    let callCount = 0;
    const http = makeHttpStub(() => {
        callCount += 1;
        return jsonResponse(200, { emojis: [] });
    });
    const client = new MisskeyClient(http);
    const now = 1_000_000;
    await client.getEmojis('a.example', now);
    await client.getEmojis('b.example', now);
    assert.equal(callCount, 2);
});

test('getEmojis() は name / url が欠けた要素を除外する', async () => {
    const http = makeHttpStub(() =>
        jsonResponse(200, { emojis: [{ name: 'ok', url: 'https://x/ok.png' }, { name: 'no-url' }, { url: 'https://x/no-name.png' }] }),
    );
    const client = new MisskeyClient(http);
    const emojis = await client.getEmojis('misskey.io');
    assert.equal(emojis.length, 1);
    assert.equal(emojis[0].name, 'ok');
});

// ------------------------------------------------------------------
// getTimeline
// ------------------------------------------------------------------

test('getTimeline() は type ごとに叩き先を切り替える', async () => {
    const seenPaths = [];
    const http = makeHttpStub(url => {
        seenPaths.push(new URL(url).pathname);
        return jsonResponse(200, []);
    });
    const client = new MisskeyClient(http);
    await client.getTimeline('misskey.io', 't', { type: 'home' });
    await client.getTimeline('misskey.io', 't', { type: 'social' });
    await client.getTimeline('misskey.io', 't', { type: 'local' });
    await client.getTimeline('misskey.io', 't', { type: 'channel', channelId: 'ch1' });
    assert.deepEqual(seenPaths, [
        '/api/notes/timeline',
        '/api/notes/hybrid-timeline',
        '/api/notes/local-timeline',
        '/api/channels/timeline',
    ]);
});

test('getTimeline() は type: channel で channelId が無ければ拒否する', async () => {
    const client = new MisskeyClient(makeHttpStub(() => jsonResponse(200, [])));
    await assert.rejects(() => client.getTimeline('misskey.io', 't', { type: 'channel' }), /ChannelIdIsRequired/);
});

test('getTimeline() は limit を 1〜50 にクランプし、untilId は指定時のみ含める', async () => {
    const http = makeHttpStub((_url, body) => {
        const parsed = JSON.parse(body);
        assert.equal(parsed.limit, 50);
        assert.equal('untilId' in parsed, false);
        return jsonResponse(200, []);
    });
    const client = new MisskeyClient(http);
    await client.getTimeline('misskey.io', 't', { type: 'home', limit: 999 });
});

test('getTimeline() は untilId を指定するとペイロードに含める', async () => {
    const http = makeHttpStub((_url, body) => {
        const parsed = JSON.parse(body);
        assert.equal(parsed.untilId, 'note-99');
        return jsonResponse(200, []);
    });
    const client = new MisskeyClient(http);
    await client.getTimeline('misskey.io', 't', { type: 'home', untilId: 'note-99' });
});

test('getTimeline() はノートの欠損フィールドを安全に埋める', async () => {
    const http = makeHttpStub(() => jsonResponse(200, [{ id: 'n1' }]));
    const client = new MisskeyClient(http);
    const notes = await client.getTimeline('misskey.io', 't', { type: 'home' });
    assert.equal(notes.length, 1);
    assert.equal(notes[0].id, 'n1');
    assert.equal(notes[0].text, null);
    assert.deepEqual(notes[0].files, []);
    assert.deepEqual(notes[0].reactions, {});
    assert.equal(notes[0].user.id, '');
});

// ------------------------------------------------------------------
// リアクション / リノート
// ------------------------------------------------------------------

test('createReaction() は noteId / reaction をペイロードに含めて POST する', async () => {
    const http = makeHttpStub((url, body) => {
        assert.equal(url, 'https://misskey.io/api/notes/reactions/create');
        const parsed = JSON.parse(body);
        assert.equal(parsed.noteId, 'note1');
        assert.equal(parsed.reaction, '👍');
        return jsonResponse(200, {});
    });
    const client = new MisskeyClient(http);
    await client.createReaction('misskey.io', 't', 'note1', '👍');
});

test('deleteReaction() は noteId だけを渡して POST する', async () => {
    const http = makeHttpStub((url, body) => {
        assert.equal(url, 'https://misskey.io/api/notes/reactions/delete');
        assert.deepEqual(JSON.parse(body), { i: 't', noteId: 'note1' });
        return jsonResponse(200, {});
    });
    const client = new MisskeyClient(http);
    await client.deleteReaction('misskey.io', 't', 'note1');
});

test('renote() は renoteId を渡して /api/notes/create を叩く', async () => {
    const http = makeHttpStub((url, body) => {
        assert.equal(url, 'https://misskey.io/api/notes/create');
        assert.deepEqual(JSON.parse(body), { i: 't', renoteId: 'note1' });
        // 実際の Misskey は notes/create の応答を createdNote でラップして返す (実機で確認済み)
        return jsonResponse(200, { createdNote: { id: 'note2' } });
    });
    const client = new MisskeyClient(http);
    const result = await client.renote('misskey.io', 't', 'note1');
    assert.equal(result.id, 'note2');
    assert.equal(result.url, 'https://misskey.io/notes/note2');
});
