'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { detectOnAirChannelIds, detectOnAirPrograms } = require('../../dist/model/epgUpdater/OnAirProgramDetector');
const {
    clampUndefinedDuration,
    isDurationUndefined,
    resolveEndAt,
    UNDEFINED_DURATION_FALLBACK_MS,
} = require('../../dist/util/ProgramDuration');

const NOW = 1785225000000;
const MINUTE = 60 * 1000;

test('a program that is on air right now marks its channel', () => {
    const programs = [{ channelId: 3241621504, startAt: NOW - 10 * MINUTE, duration: 30 * MINUTE }];
    assert.deepEqual(detectOnAirChannelIds(programs, { now: NOW }), [3241621504]);
});

test('a program starting soon (following) marks its channel too', () => {
    const programs = [{ channelId: 100, startAt: NOW + 5 * MINUTE, duration: 30 * MINUTE }];
    assert.deepEqual(detectOnAirChannelIds(programs, { now: NOW }), [100]);
});

test('programs that already ended or start far ahead are ignored', () => {
    const programs = [
        // 5 分前に終わった
        { channelId: 1, startAt: NOW - 35 * MINUTE, duration: 30 * MINUTE },
        // 3 時間後に始まる (通常の EPG 更新に任せる)
        { channelId: 2, startAt: NOW + 3 * 60 * MINUTE, duration: 30 * MINUTE },
    ];
    assert.deepEqual(detectOnAirChannelIds(programs, { now: NOW }), []);
});

test('duplicated channels are reported once and sorted', () => {
    const programs = [
        { channelId: 200, startAt: NOW, duration: 30 * MINUTE },
        { channelId: 100, startAt: NOW, duration: 30 * MINUTE },
        { channelId: 200, startAt: NOW + MINUTE, duration: 30 * MINUTE },
    ];
    assert.deepEqual(detectOnAirChannelIds(programs, { now: NOW }), [100, 200]);
});

test('broken entries never crash the detection', () => {
    const programs = [
        { channelId: 'x', startAt: NOW, duration: 1000 },
        { startAt: NOW, duration: 1000 },
        { channelId: 1, duration: 1000 },
        null,
    ];
    assert.deepEqual(detectOnAirChannelIds(programs, { now: NOW }), []);
    assert.deepEqual(detectOnAirChannelIds([], { now: NOW }), []);
    assert.deepEqual(detectOnAirChannelIds(null, { now: NOW }), []);
});

// --- 放送時間未定 (ARIB の duration = 0xFFFFFF / Mirakurun は 1 を返す) ---

test('a program with an undefined duration is recognised', () => {
    // 実データ (NHK 系のニュース枠) で観測される値
    assert.equal(isDurationUndefined(1), true);
    assert.equal(isDurationUndefined(0), true);
    assert.equal(isDurationUndefined(undefined), true);
    assert.equal(isDurationUndefined(null), true);
    assert.equal(isDurationUndefined(NaN), true);
    assert.equal(isDurationUndefined(30 * MINUTE), false);
});

test('an undefined duration gets a provisional end time instead of ending instantly', () => {
    // そのまま startAt + 1 にすると開始 1ms 後に終了扱いになり一覧から消えてしまう
    assert.equal(resolveEndAt(NOW, 1), NOW + UNDEFINED_DURATION_FALLBACK_MS);
    assert.equal(resolveEndAt(NOW, undefined), NOW + UNDEFINED_DURATION_FALLBACK_MS);
    assert.equal(resolveEndAt(NOW, 30 * MINUTE), NOW + 30 * MINUTE);
});

test('a started program with an undefined duration stays on air', () => {
    // 実データの形 (NHK 総合、duration: 1)
    const programs = [{ channelId: 3241621504, startAt: NOW - 2 * 60 * MINUTE, duration: 1 }];
    assert.deepEqual(detectOnAirChannelIds(programs, { now: NOW }), [3241621504]);
});

test('an undefined duration program that has not started yet still follows the look ahead window', () => {
    // 直後に始まるものは拾う
    assert.deepEqual(detectOnAirChannelIds([{ channelId: 1, startAt: NOW + 5 * MINUTE, duration: 1 }], { now: NOW }), [
        1,
    ]);
    // 遠い未来のものは拾わない
    assert.deepEqual(
        detectOnAirChannelIds([{ channelId: 1, startAt: NOW + 3 * 60 * MINUTE, duration: 1 }], { now: NOW }),
        [],
    );
});

test('the look ahead window is configurable', () => {
    const programs = [{ channelId: 1, startAt: NOW + 20 * MINUTE, duration: 30 * MINUTE }];
    assert.deepEqual(detectOnAirChannelIds(programs, { now: NOW }), []);
    assert.deepEqual(detectOnAirChannelIds(programs, { now: NOW, followingWindowMs: 30 * MINUTE }), [1]);
});

// --- 番組表での暫定終了時刻の切り詰め ---

test('an undefined duration program is clamped to the next program start in the guide', () => {
    const clamp = clampUndefinedDuration;
    const programs = [
        // 放送時間未定 (暫定 3 時間) だが 30 分後に次の番組が始まる
        { id: 1, startAt: NOW, endAt: NOW + 3 * 60 * MINUTE, isDurationUndefined: true },
        { id: 2, startAt: NOW + 30 * MINUTE, endAt: NOW + 60 * MINUTE },
    ];
    const result = clamp(programs);
    assert.equal(result[0].endAt, NOW + 30 * MINUTE);
    assert.equal(result[1].endAt, NOW + 60 * MINUTE);
});

test('a real long program is never clamped', () => {
    const clamp = clampUndefinedDuration;
    const programs = [
        // 実際に 3 時間ある番組 (未定フラグなし) は切り詰めない
        { id: 1, startAt: NOW, endAt: NOW + 3 * 60 * MINUTE },
        { id: 2, startAt: NOW + 3 * 60 * MINUTE, endAt: NOW + 4 * 60 * MINUTE },
    ];
    assert.equal(clamp(programs)[0].endAt, NOW + 3 * 60 * MINUTE);
});

test('an undefined duration program with no following program keeps the provisional end', () => {
    const clamp = clampUndefinedDuration;
    const programs = [{ id: 1, startAt: NOW, endAt: NOW + 3 * 60 * MINUTE, isDurationUndefined: true }];
    assert.equal(clamp(programs)[0].endAt, NOW + 3 * 60 * MINUTE);
});

// --- EIT[p/f] の区分検出 (ログ出力用) ---

test('detectOnAirPrograms marks a running program as present', () => {
    const programs = [{ channelId: 1, startAt: NOW - MINUTE, duration: 30 * MINUTE }];
    const result = detectOnAirPrograms(programs, { now: NOW });
    assert.equal(result.length, 1);
    assert.equal(result[0].section, 'present');
    assert.equal(result[0].program.channelId, 1);
});

test('detectOnAirPrograms marks an upcoming program as following', () => {
    const programs = [{ channelId: 1, startAt: NOW + 5 * MINUTE, duration: 30 * MINUTE }];
    const result = detectOnAirPrograms(programs, { now: NOW });
    assert.equal(result.length, 1);
    assert.equal(result[0].section, 'following');
});

test('detectOnAirPrograms keeps an undefined duration program that has already started', () => {
    const programs = [{ channelId: 1, startAt: NOW - 4 * 60 * MINUTE, duration: 1 }];
    const result = detectOnAirPrograms(programs, { now: NOW });
    assert.equal(result.length, 1);
    assert.equal(result[0].section, 'present');
});

test('detectOnAirPrograms keeps extra fields of the given program', () => {
    const programs = [{ channelId: 1, startAt: NOW, duration: MINUTE, source: { id: 42 } }];
    const result = detectOnAirPrograms(programs, { now: NOW });
    assert.equal(result[0].program.source.id, 42);
});
