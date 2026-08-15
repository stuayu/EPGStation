'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const AmatsukazeTextUtil = require('../../dist/model/amatsukaze/AmatsukazeTextUtil').default;

// Amatsukaze (と AmatsukazeAddTask) は日本語 Windows の ANSI コードページ (cp932) で
// コンソール出力を吐く。UTF-8 として読むと日本語が化ける。

// 「エンコーダ」の cp932 バイト列
const SJIS_ENCODER = Buffer.from([0x83, 0x47, 0x83, 0x93, 0x83, 0x52, 0x81, 0x5b, 0x83, 0x5f]);

test('cp932 のバイト列を日本語として読む', () => {
    assert.equal(AmatsukazeTextUtil.decode(SJIS_ENCODER), 'エンコーダ');
});

test('UTF-8 のバイト列はそのまま読む', () => {
    assert.equal(AmatsukazeTextUtil.decode(Buffer.from('エンコード完了', 'utf8')), 'エンコード完了');
});

test('ASCII のみの出力はどちらでも同じ', () => {
    assert.equal(AmatsukazeTextUtil.decode(Buffer.from('AmatsukazeCLI.exe -i input.ts', 'utf8')), 'AmatsukazeCLI.exe -i input.ts');
});

test('空のバイト列は空文字', () => {
    assert.equal(AmatsukazeTextUtil.decode(Buffer.alloc(0)), '');
});

test('行が完結した分だけ返す', () => {
    const decoder = new AmatsukazeTextUtil.LineDecoder();

    assert.deepEqual(decoder.push(Buffer.from('first\r\nsecond\n', 'utf8')), ['first', 'second']);
    // 改行が来るまでは返さない
    assert.deepEqual(decoder.push(Buffer.from('third', 'utf8')), []);
    assert.deepEqual(decoder.push(Buffer.from('\n', 'utf8')), ['third']);
});

test('チャンクが文字の途中で切れても化けない', () => {
    const decoder = new AmatsukazeTextUtil.LineDecoder();
    const line = Buffer.concat([SJIS_ENCODER, Buffer.from('\n', 'utf8')]);

    // 「エンコーダ」の 2 バイト文字の途中で分割する
    assert.deepEqual(decoder.push(line.subarray(0, 3)), []);
    assert.deepEqual(decoder.push(line.subarray(3)), ['エンコーダ']);
});

test('改行で終わらない最後の行は flush で取り出す', () => {
    const decoder = new AmatsukazeTextUtil.LineDecoder();

    decoder.push(SJIS_ENCODER);
    assert.equal(decoder.flush(), 'エンコーダ');
    // 取り出した後は空
    assert.equal(decoder.flush(), null);
});
