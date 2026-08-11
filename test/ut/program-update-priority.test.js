'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    classifyProgramEvent,
    getEventProgramId,
    splitUrgentProgramEvents,
} = require('../../dist/model/epgUpdater/ProgramUpdatePriority');
const { resolveEPGRealtimeConfig } = require('../../dist/model/epgUpdater/EPGRealtimeConfig');

const NOW = 1785225000000;
const MINUTE = 60 * 1000;
const OPTION = { now: NOW, urgentWindowMs: 180 * MINUTE };

/**
 * create / update イベントを作る
 */
const updateEvent = (id, startAt, duration, type = 'update') => ({
    resource: 'program',
    type: type,
    data: { id: id, startAt: startAt, duration: duration, name: 'テスト番組' },
});

const removeEvent = id => ({ resource: 'program', type: 'remove', data: { id: id } });
const redefineEvent = (from, to) => ({ resource: 'program', type: 'redefine', data: { from: from, to: to } });

test('放送中の番組の更新は即時反映の対象になる', () => {
    assert.equal(classifyProgramEvent(updateEvent(1, NOW - 10 * MINUTE, 30 * MINUTE), OPTION), 'immediate');
});

test('urgentWindow 以内に始まる番組の更新は即時反映の対象になる', () => {
    assert.equal(classifyProgramEvent(updateEvent(1, NOW + 120 * MINUTE, 30 * MINUTE), OPTION), 'immediate');
});

test('urgentWindow より先に始まる番組の更新は周期反映に回す', () => {
    assert.equal(classifyProgramEvent(updateEvent(1, NOW + 300 * MINUTE, 30 * MINUTE), OPTION), 'normal');
});

test('既に終わった番組の更新は周期反映に回す', () => {
    assert.equal(classifyProgramEvent(updateEvent(1, NOW - 60 * MINUTE, 30 * MINUTE), OPTION), 'normal');
});

test('放送時間未定 (duration = 1) への変更は時間帯に関わらず即時反映する', () => {
    // 24 時間後に始まる番組でも、放送時間未定なら特番編成の可能性があるため即時に反映する
    assert.equal(classifyProgramEvent(updateEvent(1, NOW + 24 * 60 * MINUTE, 1), OPTION), 'immediate');
});

test('番組の消滅 (remove) と付け替え (redefine) は即時反映する', () => {
    assert.equal(classifyProgramEvent(removeEvent(1), OPTION), 'immediate');
    assert.equal(classifyProgramEvent(redefineEvent(1, 2), OPTION), 'immediate');
});

test('予約済みの番組は放送時刻が先でも即時反映する', () => {
    const event = updateEvent(777, NOW + 600 * MINUTE, 30 * MINUTE);
    assert.equal(classifyProgramEvent(event, OPTION), 'normal');
    assert.equal(
        classifyProgramEvent(event, { ...OPTION, isReservedProgramId: id => id === 777 }),
        'immediate',
    );
});

test('壊れたイベントは周期反映に回す (例外を投げない)', () => {
    assert.equal(classifyProgramEvent({}, OPTION), 'normal');
    assert.equal(classifyProgramEvent({ type: 'update', data: null }, OPTION), 'normal');
    assert.equal(classifyProgramEvent({ type: 'update', data: { id: 1 } }, OPTION), 'normal');
});

test('getEventProgramId は remove の id と redefine の from を返す', () => {
    assert.equal(getEventProgramId(updateEvent(5, NOW, MINUTE)), 5);
    assert.equal(getEventProgramId(removeEvent(6)), 6);
    assert.equal(getEventProgramId(redefineEvent(7, 8)), 7);
    assert.equal(getEventProgramId({ type: 'update', data: null }), null);
});

test('即時反映の対象が無ければ urgent は空でキューは元のまま', () => {
    const queue = [updateEvent(1, NOW + 300 * MINUTE, 30 * MINUTE)];
    const result = splitUrgentProgramEvents(queue, OPTION);
    assert.deepEqual(result.urgent, []);
    assert.deepEqual(result.rest, queue);
});

test('同じ番組のイベントは追い越しが起きないようまとめて取り出される', () => {
    // 先に「遠い時刻での作成」→ 後から「直近へ繰り上げる更新」が来たケース。
    // 後者だけを先行反映すると、残った前者が後で書かれて古い時刻へ巻き戻ってしまう
    const first = updateEvent(1, NOW + 300 * MINUTE, 30 * MINUTE, 'create');
    const second = updateEvent(1, NOW + 5 * MINUTE, 30 * MINUTE);
    const other = updateEvent(2, NOW + 300 * MINUTE, 30 * MINUTE);

    const result = splitUrgentProgramEvents([first, second, other], OPTION);
    assert.deepEqual(result.urgent, [first, second]);
    assert.deepEqual(result.rest, [other]);
});

test('取り出した側・残した側とも元の順序を保つ', () => {
    const a = updateEvent(1, NOW, 30 * MINUTE);
    const b = updateEvent(2, NOW + 600 * MINUTE, 30 * MINUTE);
    const c = updateEvent(3, NOW + 10 * MINUTE, 30 * MINUTE);
    const d = updateEvent(4, NOW + 600 * MINUTE, 30 * MINUTE);

    const result = splitUrgentProgramEvents([a, b, c, d], OPTION);
    assert.deepEqual(result.urgent, [a, c]);
    assert.deepEqual(result.rest, [b, d]);
});

test('空のキューを渡しても壊れない', () => {
    assert.deepEqual(splitUrgentProgramEvents([], OPTION), { urgent: [], rest: [] });
    assert.deepEqual(splitUrgentProgramEvents(null, OPTION), { urgent: [], rest: [] });
});

test('epgRealtime 未指定なら既定値が入り、機能は有効になる', () => {
    const resolved = resolveEPGRealtimeConfig({});
    assert.equal(resolved.enabled, true);
    assert.equal(resolved.debounceMs, 500);
    assert.equal(resolved.minIntervalMs, 500);
    assert.equal(resolved.urgentWindowMs, 180 * MINUTE);
});

test('featureFlags.epgRealtimeSync: false で無効になる', () => {
    assert.equal(resolveEPGRealtimeConfig({ featureFlags: { epgRealtimeSync: false } }).enabled, false);
    // opt-out なので他のフラグだけ書かれていても有効のまま
    assert.equal(resolveEPGRealtimeConfig({ featureFlags: { dashboard: false } }).enabled, true);
});

test('不正な値・極端な値は既定値と上限で丸める', () => {
    const resolved = resolveEPGRealtimeConfig({
        epgRealtime: { debounceMs: -1, minIntervalMs: 'abc', urgentWindowMinutes: 99999 },
    });
    assert.equal(resolved.debounceMs, 500);
    assert.equal(resolved.minIntervalMs, 500);
    // 上限は 24 時間
    assert.equal(resolved.urgentWindowMs, 24 * 60 * MINUTE);
});

test('部分指定でも指定した項目だけが反映される', () => {
    const resolved = resolveEPGRealtimeConfig({ epgRealtime: { debounceMs: 1500 } });
    assert.equal(resolved.debounceMs, 1500);
    assert.equal(resolved.minIntervalMs, 500);
});
