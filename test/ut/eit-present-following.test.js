'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const EitPresentStore = require('../../dist/model/service/stream/util/EitPresentStore').default;
const {
    resolveFreshEitProgram,
    resolveEitBroadcastTime,
} = require('../../dist/model/api/schedule/EitOnAirResolver');

const NOW = 1788087600000;
const channel = { networkId: 32416, serviceId: 21504 };
const channelId = 3241621504;
const program = (eventId, startAt, duration) => ({
    id: channelId * 100000 + eventId,
    eventId,
    startAt,
    endAt: startAt + duration,
    duration,
});
const event = (eventId, startAt, durationSec, isFollowing) => ({
    eventId,
    startAt,
    durationSec,
    receivedAt: NOW,
    isFollowing,
});

test('EIT following を正として実測の次番組時刻を解決できる', () => {
    const following = program(39925, NOW + 25 * 60 * 1000, 5 * 60 * 1000);
    const eit = event(39925, NOW + 25 * 60 * 1000, 5 * 60, true);
    const found = resolveFreshEitProgram([following], channel, eit, NOW);
    assert.equal(found.id, channelId * 100000 + 39925);
    assert.deepEqual(resolveEitBroadcastTime(eit, NOW, NOW + 3 * 60 * 60 * 1000), {
        startAt: NOW + 25 * 60 * 1000,
        endAt: NOW + 30 * 60 * 1000,
        isDurationUndefined: false,
    });
});

test('present と following の変化を別々に通知する', () => {
    const store = new EitPresentStore();
    const changes = [];
    store.onChange((id, value) => changes.push([id, value.eventId, value.isFollowing]));
    assert.equal(store.update(channelId, event(5742, NOW, 25 * 60, false)), true);
    assert.equal(store.update(channelId, event(39925, NOW + 25 * 60 * 1000, 5 * 60, true)), true);
    assert.deepEqual(changes, [[channelId, 5742, false], [channelId, 39925, true]]);
    assert.equal(store.get(channelId).eventId, 5742);
    assert.equal(store.getFollowing(channelId).eventId, 39925);
});

test('鮮度切れ EIT は Mirakurun 値へ戻る', () => {
    const eit = event(39925, NOW, 300, true);
    assert.equal(resolveFreshEitProgram([program(39925, NOW, 300000)], channel, eit, NOW + 2 * 60 * 1000 + 1), null);
});

test('not running と starts in a few seconds の present は現在番組にしない', () => {
    assert.equal(
        require('../../dist/model/api/schedule/EitOnAirResolver').resolveEitOnAirProgram(
            [program(5742, NOW, 300000)],
            channel,
            { ...event(5742, NOW, 300, false), runningStatus: 1 },
            NOW,
        ),
        null,
    );
    assert.equal(
        require('../../dist/model/api/schedule/EitOnAirResolver').resolveEitOnAirProgram(
            [program(5742, NOW, 300000)],
            channel,
            { ...event(5742, NOW, 300, false), runningStatus: 2 },
            NOW,
        ),
        null,
    );
});
