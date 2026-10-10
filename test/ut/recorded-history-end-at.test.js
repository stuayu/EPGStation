'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveRecordedHistoryEndAt, shouldSaveRecordedHistory } = require('../../dist/model/operator/recording/RecordedHistoryEndAt');

test('番組終了を確認できた録画は、履歴の終了時刻を現在時刻で頭打ちにする', () => {
    // EIT の切替が予定より早い / 放送時間未定で暫定の終了時刻が未来にある
    assert.equal(resolveRecordedHistoryEndAt(2000, 1500, 'boundary'), 1500);
    assert.equal(resolveRecordedHistoryEndAt(2000, 1500, 'scheduled-end'), 1500);
});

test('予定終了より後に終わった録画は番組表の終了時刻を保つ', () => {
    assert.equal(resolveRecordedHistoryEndAt(2000, 2500, 'boundary'), 2000);
    assert.equal(resolveRecordedHistoryEndAt(2000, 2500, 'scheduled-end'), 2000);
});

test('途中で切れた録画・理由不明は番組が続いているため頭打ちにしない', () => {
    assert.equal(resolveRecordedHistoryEndAt(2000, 1500, 'transport-lost'), 2000);
    assert.equal(resolveRecordedHistoryEndAt(2000, 1500, 'canceled'), 2000);
    assert.equal(resolveRecordedHistoryEndAt(2000, 1500, null), 2000);
});

const programReserve = { programId: 10, isTimeSpecified: false, isEventRelay: false };

test('番組指定録画は手動・ルールの両方で履歴へ保存する', () => {
    assert.equal(shouldSaveRecordedHistory({ ...programReserve, ruleId: null }, true), true);
    assert.equal(shouldSaveRecordedHistory({ ...programReserve, ruleId: 1 }, true), true);
});

test('時刻指定・イベントリレー・番組IDなし・継続する予約は履歴へ保存しない', () => {
    assert.equal(shouldSaveRecordedHistory({ ...programReserve, isTimeSpecified: true }, true), false);
    assert.equal(shouldSaveRecordedHistory({ ...programReserve, isEventRelay: true }, true), false);
    assert.equal(shouldSaveRecordedHistory({ ...programReserve, programId: null }, true), false);
    assert.equal(shouldSaveRecordedHistory(programReserve, false), false);
});
