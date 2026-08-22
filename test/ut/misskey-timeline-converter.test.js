'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { convertMisskeyNoteToTimelineNote } = require('../../dist/model/sns/MisskeyTimelineConverter');

const baseUser = { id: 'u1', username: 'foo', name: 'Foo', avatarUrl: 'https://x/a.png', host: null };

const baseNote = (override = {}) => ({
    id: 'note1',
    createdAt: '2026-08-01T00:00:00.000Z',
    text: 'hello',
    cw: null,
    user: baseUser,
    files: [],
    reactions: {},
    reactionEmojis: {},
    myReaction: null,
    renoteCount: 0,
    renote: null,
    ...override,
});

test('通常のノートを共通形へ変換する (author.handle はリモートユーザーのみ host を付ける)', () => {
    const note = baseNote();
    const result = convertMisskeyNoteToTimelineNote('misskey.io', note);
    assert.equal(result.id, 'note1');
    assert.equal(result.text, 'hello');
    assert.equal(result.author.handle, 'foo');
    assert.equal(result.author.displayName, 'Foo');
    assert.equal(result.url, 'https://misskey.io/notes/note1');
    assert.equal(result.createdAt, Date.parse('2026-08-01T00:00:00.000Z'));
});

test('リモートユーザーの handle は username@host になる', () => {
    const note = baseNote({ user: { ...baseUser, host: 'remote.example' } });
    const result = convertMisskeyNoteToTimelineNote('misskey.io', note);
    assert.equal(result.author.handle, 'foo@remote.example');
});

test('Unicode リアクションは url が null、カスタム絵文字リアクションは reactionEmojis から url を引く', () => {
    const note = baseNote({
        reactions: { '👍': 3, ':party:': 1 },
        reactionEmojis: { party: 'https://x/party.png' },
        myReaction: ':party:',
    });
    const result = convertMisskeyNoteToTimelineNote('misskey.io', note);
    const thumbsUp = result.reactions.find(r => r.name === '👍');
    const party = result.reactions.find(r => r.name === ':party:');
    assert.equal(thumbsUp.url, null);
    assert.equal(thumbsUp.isMine, false);
    assert.equal(party.url, 'https://x/party.png');
    assert.equal(party.isMine, true);
});

test('リモートインスタンスのカスタム絵文字 (:name@host: 形式) も name だけで引ける', () => {
    const note = baseNote({
        reactions: { ':party@remote.example:': 2 },
        reactionEmojis: { party: 'https://x/party.png' },
    });
    const result = convertMisskeyNoteToTimelineNote('misskey.io', note);
    assert.equal(result.reactions[0].url, 'https://x/party.png');
});

test('本文もファイルも持たない純粋なリノートは参照先の本文・添付・CW を借りる', () => {
    const note = baseNote({
        text: null,
        cw: null,
        files: [],
        renote: {
            ...baseNote({ id: 'inner1', text: 'inner text', cw: 'spoiler' }),
            files: [{ url: 'https://x/1.jpg', thumbnailUrl: 'https://x/1_thumb.jpg', isSensitive: true }],
        },
    });
    const result = convertMisskeyNoteToTimelineNote('misskey.io', note);
    // id / url はあくまで outer (リノート自体) のもの
    assert.equal(result.id, 'note1');
    assert.equal(result.text, 'inner text');
    assert.equal(result.cw, 'spoiler');
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].isSensitive, true);
});

test('text が空文字のノート (本文なし画像のみ) はリノート扱いにしない', () => {
    const note = baseNote({ text: '', files: [{ url: 'https://x/1.jpg', thumbnailUrl: null, isSensitive: false }] });
    const result = convertMisskeyNoteToTimelineNote('misskey.io', note);
    assert.equal(result.text, '');
    assert.equal(result.images.length, 1);
});

test('isRenotedByMe は常に false を返す (割り切り)', () => {
    const result = convertMisskeyNoteToTimelineNote('misskey.io', baseNote());
    assert.equal(result.isRenotedByMe, false);
});

// --- 修正1 (リアクション絵文字の解決) のリグレッションテスト ---
// reactionEmojis のキーはリモート絵文字だと 'name@host'、ローカルだと 'name' になる。
// これを取り違えると url が解決できず、クライアントが ':name:' のテキストのまま表示してしまう

test('リモート絵文字は reactionEmojis の "name@host" キーで解決する', () => {
    const note = baseNote({
        reactions: { ':party@remote.example:': 2 },
        // リモート絵文字は reactionEmojis のキーが 'name' 単体ではなく 'name@host' になる
        reactionEmojis: { 'party@remote.example': 'https://remote.example/party.png' },
    });
    const result = convertMisskeyNoteToTimelineNote('misskey.io', note);
    assert.equal(result.reactions[0].url, 'https://remote.example/party.png');
});

test('ローカル絵文字は reactionEmojis の "name" キーで解決する', () => {
    const note = baseNote({
        reactions: { ':party:': 1 },
        reactionEmojis: { party: 'https://misskey.io/party.png' },
    });
    const result = convertMisskeyNoteToTimelineNote('misskey.io', note);
    assert.equal(result.reactions[0].url, 'https://misskey.io/party.png');
});

test('Unicode 絵文字リアクションは :name: 形式にマッチしないため url は常に null (正常動作)', () => {
    const note = baseNote({ reactions: { '👍': 5 }, reactionEmojis: {} });
    const result = convertMisskeyNoteToTimelineNote('misskey.io', note);
    assert.equal(result.reactions[0].name, '👍');
    assert.equal(result.reactions[0].url, null);
});

test('reactionEmojis が空 (WebSocket 中継の note 等) でも resolveEmojiUrl のフォールバックで解決する', () => {
    const note = baseNote({
        reactions: { ':party:': 1 },
        reactionEmojis: {},
    });
    const result = convertMisskeyNoteToTimelineNote('misskey.io', note, name =>
        name === 'party' ? 'https://misskey.io/cache/party.png' : null,
    );
    assert.equal(result.reactions[0].url, 'https://misskey.io/cache/party.png');
});

test('reactionEmojis が空かつ resolveEmojiUrl でも解決できなければ url は null', () => {
    const note = baseNote({ reactions: { ':unknown:': 1 }, reactionEmojis: {} });
    const result = convertMisskeyNoteToTimelineNote('misskey.io', note, () => null);
    assert.equal(result.reactions[0].url, null);
});
