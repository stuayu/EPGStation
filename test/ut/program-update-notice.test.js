'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    buildProgramUpdateNotice,
    hasProgramUpdateNotice,
} = require('../../dist/model/epgUpdater/ProgramUpdateNotice');
const { UNDEFINED_DURATION_FALLBACK_MS } = require('../../dist/util/ProgramDuration');
const ReservationManageModel = require('../../dist/model/operator/reservation/ReservationManageModel').default;

const NOW = 1785225000000;
const MINUTE = 60 * 1000;

const NOOP_LOGGER = {
    getLogger: () => ({
        system: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, fatal: () => {} },
    }),
};

const program = (id, startAt, duration, channelId = 3273601024) => ({
    id: id,
    startAt: startAt,
    duration: duration,
    // getChannelId が引けるように持たせる
    channelId: channelId,
});

const build = (changed, deleted = [], programIdLimit = 1000) =>
    buildProgramUpdateNotice({
        changed: changed,
        deleted: deleted,
        getChannelId: p => p.channelId ?? null,
        programIdLimit: programIdLimit,
    });

test('変更された番組の放送局と時間帯の全体をまとめる', () => {
    const notice = build([
        program(1, NOW, 30 * MINUTE, 100),
        program(2, NOW + 60 * MINUTE, 30 * MINUTE, 200),
        program(3, NOW - 30 * MINUTE, 30 * MINUTE, 100),
    ]);

    assert.deepEqual(notice.programIds, [1, 2, 3]);
    assert.deepEqual(notice.channelIds, [100, 200]);
    assert.equal(notice.startAt, NOW - 30 * MINUTE);
    assert.equal(notice.endAt, NOW + 90 * MINUTE);
});

test('放送時間未定の番組は暫定の終了時刻で範囲に含める', () => {
    const notice = build([program(1, NOW, 1)]);
    assert.equal(notice.endAt, NOW + UNDEFINED_DURATION_FALLBACK_MS);
});

test('削除された番組は id だけ載せる (放送局・時間帯は分からない)', () => {
    const notice = build([], [10, 11]);

    assert.deepEqual(notice.programIds, [10, 11]);
    assert.deepEqual(notice.channelIds, []);
    assert.equal(notice.startAt, null);
    assert.equal(notice.endAt, null);
});

test('放送局を引けない番組は channelIds に載せないが時間帯には含める', () => {
    const notice = build([program(1, NOW, 30 * MINUTE, null)]);

    assert.deepEqual(notice.channelIds, []);
    assert.equal(notice.startAt, NOW);
});

test('番組 id が上限を超えたら載せない (周期的な予約全体更新に任せる)', () => {
    const changed = [];
    for (let i = 0; i < 5; i++) {
        changed.push(program(i, NOW, 30 * MINUTE, 100));
    }

    const notice = build(changed, [], 3);
    assert.deepEqual(notice.programIds, []);
    // 番組表向けの情報は残る
    assert.deepEqual(notice.channelIds, [100]);
    assert.equal(notice.startAt, NOW);
});

test('hasProgramUpdateNotice は通知すべき内容の有無を返す', () => {
    assert.equal(hasProgramUpdateNotice(build([program(1, NOW, 30 * MINUTE)])), true);
    assert.equal(hasProgramUpdateNotice(build([], [5])), true);
    assert.equal(hasProgramUpdateNotice(build([], [])), false);
});

/**
 * updateReservesByProgramIds だけを動かすための最小構成を作る
 */
const createModel = reserves => {
    const requestedProgramIds = [];
    const reserveDB = {
        findProgramIds: async programIds => {
            requestedProgramIds.push(programIds);

            return reserves;
        },
    };

    const model = new ReservationManageModel(
        NOOP_LOGGER,
        { getConfig: () => ({}) },
        {},
        {},
        reserveDB,
        {},
        {},
        {},
        {},
    );

    const updatedIds = [];
    model.update = async reserveId => {
        updatedIds.push(reserveId);
    };

    return { model, requestedProgramIds, updatedIds };
};

test('変更のあった番組 id に一致する予約を放送時刻に関わらず追従させる', async () => {
    const { model, requestedProgramIds, updatedIds } = createModel([
        { id: 1, programId: 100, isSkip: false },
        // 除外済みの予約は対象外
        { id: 2, programId: 200, isSkip: true },
        { id: 3, programId: 300, isSkip: false },
    ]);

    await model.updateReservesByProgramIds([100, 200, 300]);

    assert.deepEqual(requestedProgramIds, [[100, 200, 300]]);
    assert.deepEqual(updatedIds, [1, 3]);
});

test('番組 id が空なら予約を引きに行かない', async () => {
    const { model, requestedProgramIds, updatedIds } = createModel([{ id: 1, programId: 100, isSkip: false }]);

    await model.updateReservesByProgramIds([]);

    assert.deepEqual(requestedProgramIds, []);
    assert.deepEqual(updatedIds, []);
});
