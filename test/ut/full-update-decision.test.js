'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    decideFullUpdate,
    shouldRunStreamStartFullUpdate,
} = require('../../dist/model/epgUpdater/FullUpdateDecision');

const MIN = 60 * 1000;
const NOW = 1_800_000_000_000;

const base = extra =>
    Object.assign(
        {
            isEventStreamAlive: true,
            now: NOW,
            lastUpdatedTime: NOW,
            lastEventStreamUpdatedTime: NOW,
            lastFullUpdatedTime: NOW,
            updateIntervalMs: 10 * MIN,
            fullRefreshIntervalMs: 360 * MIN,
        },
        extra,
    );

test('通常時は全件取得しない', () => {
    assert.equal(decideFullUpdate(base()), null);
});

test('event stream が切れて更新間隔の 1.5 倍を過ぎたら全件取得する', () => {
    assert.equal(
        decideFullUpdate(base({ isEventStreamAlive: false, lastUpdatedTime: NOW - 15 * MIN })),
        'streamDown',
    );
    // まだ 1.5 倍に達していない
    assert.equal(decideFullUpdate(base({ isEventStreamAlive: false, lastUpdatedTime: NOW - 14 * MIN })), null);
});

test('event stream は生きているが更新が長時間来なければ全件取得する', () => {
    assert.equal(decideFullUpdate(base({ lastEventStreamUpdatedTime: NOW - 15 * MIN })), 'staleEventStream');
    assert.equal(decideFullUpdate(base({ lastEventStreamUpdatedTime: NOW - 14 * MIN })), null);
});

test('起動直後 (lastEventStreamUpdatedTime が 0) はウォッチドッグを働かせない', () => {
    assert.equal(decideFullUpdate(base({ lastEventStreamUpdatedTime: 0, lastFullUpdatedTime: NOW })), null);
});

test('イベントが届き続けていても間隔を過ぎたら定期的に全件突き合わせる (Issue #6)', () => {
    // イベントは今も届いている = 従来のウォッチドッグは発火しない
    const input = base({ lastEventStreamUpdatedTime: NOW, lastFullUpdatedTime: NOW - 360 * MIN });
    assert.equal(decideFullUpdate(input), 'periodic');
});

test('定期突き合わせは間隔前には走らない', () => {
    assert.equal(decideFullUpdate(base({ lastFullUpdatedTime: NOW - 359 * MIN })), null);
});

test('定期突き合わせは 0 で無効にできる', () => {
    assert.equal(
        decideFullUpdate(base({ fullRefreshIntervalMs: 0, lastFullUpdatedTime: NOW - 10000 * MIN })),
        null,
    );
});

test('全件取得が一度も成功していない間は定期突き合わせを走らせない', () => {
    assert.equal(decideFullUpdate(base({ lastFullUpdatedTime: 0 })), null);
});

test('ウォッチドッグと定期突き合わせが同時に成立したらウォッチドッグを優先する', () => {
    const input = base({ lastEventStreamUpdatedTime: NOW - 15 * MIN, lastFullUpdatedTime: NOW - 400 * MIN });
    assert.equal(decideFullUpdate(input), 'staleEventStream');
});

test('event stream が切れている場合は定期突き合わせの条件を見ない', () => {
    // stream が切れていて lastUpdatedTime が新しいなら、全件取得はまだ走らせない
    const input = base({ isEventStreamAlive: false, lastUpdatedTime: NOW, lastFullUpdatedTime: NOW - 400 * MIN });
    assert.equal(decideFullUpdate(input), null);
});

test('event stream の直後の再接続では全件更新を省略し、間隔後は実行する', () => {
    const minute = 60 * 1000;
    assert.equal(shouldRunStreamStartFullUpdate(100 * minute, 100 * minute + 59 * 1000, minute), false);
    assert.equal(shouldRunStreamStartFullUpdate(100 * minute, 101 * minute, minute), true);
    assert.equal(shouldRunStreamStartFullUpdate(0, 1, minute), true);
});
