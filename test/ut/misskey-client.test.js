'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const MisskeyClient = require('../../dist/model/sns/MisskeyClient').default;
const { MisskeyApiError } = require('../../dist/model/sns/IMisskeyClient');

// IProviderHttpClient のスタブ。呼び出し履歴を残しつつ URL に応じて応答を切り替える
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

test('getMe() は /api/i へ i (token) を渡し、ユーザー情報へ変換する', async () => {
    const http = makeHttpStub(url => {
        assert.equal(url, 'https://misskey.io/api/i');
        return jsonResponse(200, { id: 'u1', username: 'foo', name: 'Foo', avatarUrl: 'https://x/a.png', host: null });
    });
    const client = new MisskeyClient(http);
    const user = await client.getMe('misskey.io', 'token-1');
    assert.deepEqual(user, { id: 'u1', username: 'foo', name: 'Foo', avatarUrl: 'https://x/a.png', host: null });
    assert.equal(http.calls[0].body, JSON.stringify({ i: 'token-1' }));
});

test('createNote() はチャンネル指定時に visibility を強制的に public にする', async () => {
    const http = makeHttpStub((url, body) => {
        assert.equal(url, 'https://misskey.io/api/notes/create');
        const parsed = JSON.parse(body);
        assert.equal(parsed.visibility, 'public');
        assert.equal(parsed.channelId, 'ch1');
        // 実際の Misskey は notes/create の応答を createdNote でラップして返す (実機で確認済み)
        return jsonResponse(200, { createdNote: { id: 'note1' } });
    });
    const client = new MisskeyClient(http);
    const result = await client.createNote('misskey.io', 'token-1', {
        text: 'hello',
        visibility: 'home',
        localOnly: false,
        channelId: 'ch1',
        fileIds: [],
        cw: null,
    });
    assert.equal(result.id, 'note1');
    assert.equal(result.url, 'https://misskey.io/notes/note1');
});

test('createNote() は本文が空かつ画像もなければ送信前に拒否する', async () => {
    const http = makeHttpStub(() => {
        throw new Error('should not be called');
    });
    const client = new MisskeyClient(http);
    await assert.rejects(
        () => client.createNote('misskey.io', 'token-1', {
            text: '   ',
            visibility: 'public',
            localOnly: false,
            fileIds: [],
        }),
        /MisskeyPostContentIsEmpty/,
    );
});

test('createNote() は cw / localOnly が指定されたときだけペイロードに含める', async () => {
    const http = makeHttpStub((url, body) => {
        const parsed = JSON.parse(body);
        assert.equal(parsed.cw, 'spoiler');
        assert.equal(parsed.localOnly, true);
        assert.equal('channelId' in parsed, false);
        return jsonResponse(200, { createdNote: { id: 'note2' } });
    });
    const client = new MisskeyClient(http);
    await client.createNote('misskey.io', 'token-1', {
        text: 'hi',
        visibility: 'public',
        localOnly: true,
        fileIds: [],
        cw: 'spoiler',
    });
});

test('createNote() は実機の応答形式 (createdNote でラップ) からノート id を取り出す', async () => {
    const http = makeHttpStub(() => jsonResponse(200, { createdNote: { id: 'wrapped-note' } }));
    const client = new MisskeyClient(http);
    const result = await client.createNote('misskey.io', 'token-1', {
        text: 'hello',
        visibility: 'public',
        localOnly: false,
        fileIds: [],
    });
    assert.equal(result.id, 'wrapped-note');
    assert.equal(result.url, 'https://misskey.io/notes/wrapped-note');
});

test('createNote() は createdNote が無くても id が直下にあれば拾う (後方互換)', async () => {
    const http = makeHttpStub(() => jsonResponse(200, { id: 'flat-note' }));
    const client = new MisskeyClient(http);
    const result = await client.createNote('misskey.io', 'token-1', {
        text: 'hello',
        visibility: 'public',
        localOnly: false,
        fileIds: [],
    });
    assert.equal(result.id, 'flat-note');
});

test('createNote() は createdNote も id も無ければ MisskeyApiError を投げる', async () => {
    const http = makeHttpStub(() => jsonResponse(200, {}));
    const client = new MisskeyClient(http);
    await assert.rejects(
        () =>
            client.createNote('misskey.io', 'token-1', {
                text: 'hello',
                visibility: 'public',
                localOnly: false,
                fileIds: [],
            }),
        e => e instanceof MisskeyApiError && /note id is missing/.test(e.message),
    );
});

test('getChannels() は followed / owned を重複排除しつつマージする', async () => {
    const http = makeHttpStub(url => {
        if (url.endsWith('/api/channels/followed')) {
            return jsonResponse(200, [{ id: 'c1', name: 'Channel1' }]);
        }
        return jsonResponse(200, [
            { id: 'c1', name: 'Channel1' },
            { id: 'c2', name: 'Channel2' },
        ]);
    });
    const client = new MisskeyClient(http);
    const channels = await client.getChannels('misskey.io', 'token-1');
    assert.deepEqual(
        channels.sort((a, b) => a.id.localeCompare(b.id)),
        [
            { id: 'c1', name: 'Channel1' },
            { id: 'c2', name: 'Channel2' },
        ],
    );
});

test('checkAuth() は ok:true でなければ MisskeyApiError を投げる', async () => {
    const http = makeHttpStub(() => jsonResponse(200, { ok: false }));
    const client = new MisskeyClient(http);
    await assert.rejects(() => client.checkAuth('misskey.io', 'session-1'), MisskeyApiError);
});

test('checkAuth() は成功時にトークンとユーザー情報を返す', async () => {
    const http = makeHttpStub(url => {
        assert.equal(url, 'https://misskey.io/api/miauth/session-1/check');
        return jsonResponse(200, { ok: true, token: 'tok', user: { id: 'u2', username: 'bar' } });
    });
    const client = new MisskeyClient(http);
    const result = await client.checkAuth('misskey.io', 'session-1');
    assert.equal(result.token, 'tok');
    assert.equal(result.user.username, 'bar');
});

test('getMe() は成功ステータスでも id / username が欠けたユーザー応答を拒否する', async () => {
    const http = makeHttpStub(() => jsonResponse(200, { name: 'no id or username' }));
    const client = new MisskeyClient(http);
    await assert.rejects(
        () => client.getMe('misskey.io', 'token-1'),
        e => e instanceof MisskeyApiError && /missing required fields/.test(e.message),
    );
});

test('uploadFile() はバイナリ body で fetch し、ファイル id を返す (folderId 指定時はフォームに含める / file に MIME type を渡す)', async () => {
    const originalFetch = global.fetch;
    let capturedForm = null;
    global.fetch = async (url, init) => {
        assert.equal(url, 'https://misskey.io/api/drive/files/create');
        assert.equal(init.method, 'POST');
        capturedForm = init.body;
        return { status: 200, text: async () => JSON.stringify({ id: 'file-1' }) };
    };
    try {
        const client = new MisskeyClient(makeHttpStub(() => jsonResponse(200, {})));
        const fileId = await client.uploadFile(
            'misskey.io',
            'token-1',
            Buffer.from([1, 2, 3]),
            'a.png',
            'image/png',
            'folder-1',
        );
        assert.equal(fileId, 'file-1');
        assert.equal(capturedForm.get('i'), 'token-1');
        assert.equal(capturedForm.get('folderId'), 'folder-1');
        // type 未指定の Blob は application/octet-stream として送られ、Misskey 側が画像と認識できない
        // 可能性があるため、渡された MIME type がそのまま Blob へ反映されていることを確認する
        assert.equal(capturedForm.get('file').type, 'image/png');
    } finally {
        global.fetch = originalFetch;
    }
});

test('uploadFile() は成功ステータスでも body に id が無ければ MisskeyApiError を投げる', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({ status: 200, text: async () => JSON.stringify({}) });
    try {
        const client = new MisskeyClient(makeHttpStub(() => jsonResponse(200, {})));
        await assert.rejects(
            () => client.uploadFile('misskey.io', 'token-1', Buffer.from([1]), 'a.png', 'image/jpeg'),
            e => e instanceof MisskeyApiError && /uploaded file id is missing/.test(e.message),
        );
    } finally {
        global.fetch = originalFetch;
    }
});

test('API がエラーオブジェクトを返したら MisskeyApiError として code / message を伝える', async () => {
    const http = makeHttpStub(() => ({
        status: 400,
        headers: new Map(),
        text: '',
        json: () => ({ error: { code: 'INVALID_PARAM', message: 'bad request' } }),
    }));
    const client = new MisskeyClient(http);
    try {
        await client.getMe('misskey.io', 'bad-token');
        assert.fail('should have thrown');
    } catch (e) {
        assert.ok(e instanceof MisskeyApiError);
        assert.equal(e.code, 'INVALID_PARAM');
        assert.equal(e.detail, 'bad request');
    }
});
