'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    isMutedComment,
    normalizeCommentKeyword,
    compileCommentMuteSettings,
    shouldMuteCompiledComment,
} = require('../../dist/util/CommentMuteUtil');

test('ユーザー ID をミュートする', () => {
    assert.equal(isMutedComment('hello', { mutedUserIds: ['user-1'] }, { userId: 'user-1' }), true);
    assert.equal(isMutedComment('hello', { mutedUserIds: ['user-1'] }, { userId: 'user-2' }), false);
});

test('キーワードの部分・前方・後方・完全一致を判定する', () => {
    for (const [match, comment, shouldMute] of [
        ['partial', 'abc def', true],
        ['forward', 'abc def', true],
        ['backward', 'abc def', false],
        ['backward', 'def abc', true],
        ['exact', 'abc', true],
        ['exact', 'abc def', false],
    ]) {
        assert.equal(isMutedComment(comment, { mutedKeywords: [{ match, pattern: 'abc' }] }), shouldMute, match);
    }
});

test('不正な正規表現は例外にせず次の条件へ進む', () => {
    assert.equal(isMutedComment('safe', { mutedKeywords: [{ match: 'regex', pattern: '[' }] }), false);
    assert.equal(
        isMutedComment('safe', {
            mutedKeywords: [
                { match: 'regex', pattern: '[' },
                { match: 'partial', pattern: 'safe' },
            ],
        }),
        true,
    );
});

test('NFKCと大小文字・ハイフン類を正規化して照合する', () => {
    assert.equal(normalizeCommentKeyword('ＡＢＣ　３３ー４'), 'abc 33-4');
    assert.equal(
        isMutedComment('ＡＢＣ　３３ー４', {
            normalizeKeywords: true,
            mutedKeywords: [{ match: 'exact', pattern: 'abc 33-4' }],
        }),
        true,
    );
});

test('固定・色・サイズ・露骨表現・差別表現・連続文字・絵文字のみをミュートする', () => {
    assert.equal(isMutedComment('hello', { muteFixed: true }, { position: 'ue' }), true);
    assert.equal(isMutedComment('hello', { muteColored: true }), false);
    for (const color of ['#FFFFFF', '#FFEAEA', 'white', 'WHITE']) {
        assert.equal(isMutedComment('hello', { muteColored: true }, { color }), false, color);
    }
    assert.equal(isMutedComment('hello', { muteColored: true }, { color: '#ff0000' }), true);
    assert.equal(isMutedComment('hello', { muteBigSize: true }, { size: 'big' }), true);
    assert.equal(isMutedComment('セックス', { muteVulgar: true }), true);
    assert.equal(isMutedComment('死ね', { muteAbusive: true }), true);
    assert.equal(isMutedComment('ああああああああ', { muteConsecutiveCharacters: true }), true);
    assert.equal(isMutedComment('😀😃', { muteEmojiOnly: true }), true);
    assert.equal(isMutedComment('😀hello', { muteEmojiOnly: true }), false);
});

test('設定画面の変更を最新設定へ適用し、他経路の追加を保持する', () => {
    const { mergeCommentMuteSettings } = require('../../dist/util/CommentMuteUtil');
    const baseline = { mutedUserIds: ['a'], muteBigSize: false };
    const edited = { mutedUserIds: ['a'], muteBigSize: true };
    const latest = { mutedUserIds: ['a', 'b'], muteBigSize: false };
    assert.deepEqual(mergeCommentMuteSettings(baseline, edited, latest), {
        mutedUserIds: ['a', 'b'],
        muteBigSize: true,
    });
});

test('既定の特殊コマンドと統計迷惑コメントをミュートする', () => {
    assert.equal(isMutedComment('/nicoad 123'), true);
    assert.equal(isMutedComment('計1447ＩＤ'), true);
    assert.equal(isMutedComment('普通のコメント'), false);
});

test('コンパイル済み設定で正規化・正規表現を再利用して判定する', () => {
    const compiled = compileCommentMuteSettings({
        normalizeKeywords: true,
        mutedKeywords: [
            { match: 'regex', pattern: '^bad' },
            { match: 'partial', pattern: 'ＡＢＣ' },
        ],
    });
    assert.equal(shouldMuteCompiledComment('bad user', compiled), true);
    assert.equal(shouldMuteCompiledComment('xx abc yy', compiled), true);
    assert.equal(shouldMuteCompiledComment('safe', compiled), false);
});
