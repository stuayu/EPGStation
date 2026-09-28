'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const toSeconds = time => {
    const [hour, minute] = time.split(':').map(Number);
    return hour * 3600 + minute * 60;
};
const toTime = minutes =>
    `${String(Math.floor((minutes % 1440) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

test('時刻指定ルールは複数局・複数枠を分単位で保存し読み戻せる', async () => {
    const { createTimeReserveOption, createTimeSpecificationSearchOption, getRuleOptionMode } =
        await import('../../client/src/util/TimeSpecificationOption.mjs');
    const source = {
        keyword: 'ドラマ',
        channels: [10, 20],
        times: [
            { startTime: '23:30', endTime: '01:15', week: { mon: true, tue: false } },
            { startTime: '09:07', endTime: '10:42', week: { mon: false, tue: true } },
        ],
    };
    const saved = createTimeSpecificationSearchOption(
        source,
        toSeconds,
        week => (week.mon ? 2 : 0) | (week.tue ? 4 : 0),
    );
    assert.deepEqual(saved.channelIds, [10, 20]);
    assert.deepEqual(
        saved.times.map(time => [time.start, time.startMinute, time.range, time.rangeMinute]),
        [
            [23 * 3600, 30, 3600, 45],
            [9 * 3600, 7, 3600, 35],
        ],
    );
    const restored = createTimeReserveOption(saved, toTime, week => ({
        mon: Boolean(week & 2),
        tue: Boolean(week & 4),
    }));
    assert.deepEqual(restored, source);
    assert.equal(getRuleOptionMode(true), 'time');
    assert.equal(getRuleOptionMode(false), 'search');
});
