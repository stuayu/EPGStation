'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const EDCBFileNameParser = require('../../dist/model/recorded/import/EDCBFileNameParser').default;
const EDCBProgramTxtParser = require('../../dist/model/recorded/import/EDCBProgramTxtParser').default;
const EDCBErrParser = require('../../dist/model/recorded/import/EDCBErrParser').default;

test('EDCBFileNameParser parses yyyyMMddHHmm_name_channel pattern', () => {
    const result = EDCBFileNameParser.parse('202607262100_テスト番組_TOKYOMX');
    assert.notEqual(result, null);
    assert.equal(result.name, 'テスト番組');
    assert.equal(result.channelName, 'TOKYOMX');
    const date = new Date(result.startAt);
    assert.equal(date.getFullYear(), 2026);
    assert.equal(date.getMonth(), 6); // 0-indexed -> July
    assert.equal(date.getDate(), 26);
    assert.equal(date.getHours(), 21);
    assert.equal(date.getMinutes(), 0);
});

test('EDCBFileNameParser parses name_channel_yyyyMMdd-HHmm pattern', () => {
    const result = EDCBFileNameParser.parse('テスト番組_TOKYOMX_20260726-2100');
    assert.notEqual(result, null);
    assert.equal(result.name, 'テスト番組');
    assert.equal(result.channelName, 'TOKYOMX');
});

test('EDCBFileNameParser returns null for unrecognized names', () => {
    assert.equal(EDCBFileNameParser.parse('random-file-name'), null);
});

test('EDCBFileNameParser prefers a valid custom pattern over presets', () => {
    const result = EDCBFileNameParser.parse('CH=BS11__20260726_2100', ['^CH=(?<channel>[^_]+)__(?<year>\\d{4})(?<month>\\d{2})(?<day>\\d{2})_(?<hour>\\d{2})(?<min>\\d{2})$']);
    assert.notEqual(result, null);
    assert.equal(result.channelName, 'BS11');
});

test('EDCBFileNameParser ignores invalid custom regex and falls back to presets', () => {
    const result = EDCBFileNameParser.parse('202607262100_テスト番組_TOKYOMX', ['(unterminated[']);
    assert.notEqual(result, null);
    assert.equal(result.channelName, 'TOKYOMX');
});

test('EDCBProgramTxtParser parses labeled fields', () => {
    const content = ['番組名: サンプル番組', 'チャンネル: TOKYOMX', '2026/07/26(日) 21:00 ～ 21:30', '概要: あらすじです'].join('\n');
    const result = EDCBProgramTxtParser.parse(content);
    assert.equal(result.name, 'サンプル番組');
    assert.equal(result.channelName, 'TOKYOMX');
    assert.equal(result.description, 'あらすじです');
    assert.ok(typeof result.startAt === 'number');
    assert.ok(typeof result.endAt === 'number');
    assert.ok(result.endAt > result.startAt);
});

test('EDCBProgramTxtParser falls back to line order when there are no labels', () => {
    const content = ['サンプル番組', 'TOKYOMX'].join('\n');
    const result = EDCBProgramTxtParser.parse(content);
    assert.equal(result.name, 'サンプル番組');
    assert.equal(result.channelName, 'TOKYOMX');
});

test('EDCBErrParser counts drop and scrambling lines separately', () => {
    const content = ['drop at 100', 'scrambling detected', 'drop at 200', ''].join('\n');
    const result = EDCBErrParser.parse(content);
    assert.equal(result.dropCount, 2);
    assert.equal(result.scramblingCount, 1);
});

test('EDCBErrParser returns zeros for empty content', () => {
    const result = EDCBErrParser.parse('');
    assert.equal(result.dropCount, 0);
    assert.equal(result.scramblingCount, 0);
});
