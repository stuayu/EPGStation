'use strict';

require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { DataSource } = require('typeorm');
const Program = require('../../dist/db/entities/Program').default;
const Rule = require('../../dist/db/entities/Rule').default;
const Reserve = require('../../dist/db/entities/Reserve').default;
const RecordedHistory = require('../../dist/db/entities/RecordedHistory').default;
const ProgramDB = require('../../dist/model/db/ProgramDB').default;
const RuleDB = require('../../dist/model/db/RuleDB').default;
const ReserveDB = require('../../dist/model/db/ReserveDB').default;
const ReservationManageModel = require('../../dist/model/operator/reservation/ReservationManageModel').default;
const EventSetter = require('../../dist/model/event/EventSetter').default;
const StrUtil = require('../../dist/util/StrUtil').default;

const NOW = Date.UTC(2026, 9, 10, 3);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NAME = '重複除外検証 第1話';

async function waitUntil(predicate) {
    for (let i = 0; i < 400; i++) {
        if (await predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('timeout waiting for condition');
}

async function makeHarness(scheduler, periodToAvoidDuplicate, t, otherRuleFirst = false) {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const source = new DataSource({
        type: 'better-sqlite3', database: ':memory:',
        entities: [Program, Rule, Reserve, RecordedHistory], synchronize: true,
    });
    await source.initialize();
    t.after(() => source.destroy());
    const errors = [];
    const logger = { getLogger: () => ({ system: {
        info() {}, debug() {}, warn() {}, fatal() {}, error: value => errors.push(value),
    } }) };
    const config = { getConfig: () => ({ reservation: scheduler === 'legacy' ? { scheduler } : {}, isSuppressReservesUpdateAllLog: true }) };
    const op = {
        getConnection: async () => source,
        isEnableCS: () => false,
        isEnabledRegexp: () => false,
        getLikeStr: () => 'like',
        convertBoolean: value => value ? 1 : 0,
    };
    const retry = { run: callback => callback() };
    const programDB = new ProgramDB(logger, config, op, retry);
    const ruleDB = new RuleDB(op, retry, logger);
    const reserveDB = new ReserveDB(op, retry, logger);
    const events = [];
    let executionLocked = false;
    const execution = {
        getExecution: async () => {
            assert.equal(executionLocked, false, '実行権保持中の再取得は自己デッドロックになる');
            executionLocked = true;
            return 1;
        },
        unLockExecution: () => {
            assert.equal(executionLocked, true, '実行権を二重に解放しない');
            executionLocked = false;
        },
    };
    const model = new ReservationManageModel(
        logger, config, execution, {},
        reserveDB, {}, programDB, ruleDB, { emitUpdated: diff => events.push(diff) },
    );
    model.setTuners([{ index: 0, name: 'GR tuner', types: ['GR'], command: '', isAvailable: true }]);
    const addOtherRule = async () => ruleDB.insertOnce({
        isTimeSpecification: false,
        searchOption: { keyword: '重複除外検証', name: true },
        reserveOption: { enable: true, avoidDuplicate: false, allowEndLack: true },
    });
    const earlierOtherRuleId = otherRuleFirst ? await addOtherRule() : null;
    const ruleId = await ruleDB.insertOnce({
        isTimeSpecification: false,
        searchOption: { keyword: '重複除外検証', name: true },
        reserveOption: { enable: true, avoidDuplicate: true, periodToAvoidDuplicate, allowEndLack: true },
    });
    const addProgram = async (id, values = {}) => {
        const name = values.name ?? `${NAME}[再]`;
        const halfWidthName = StrUtil.toHalf(name);
        await source.getRepository(Program).save({
            id, updateTime: NOW, channelId: 1, eventId: id, serviceId: 1, networkId: 1,
            startAt: NOW + HOUR * id, endAt: NOW + HOUR * id + HOUR / 2,
            startHour: 12, week: 6, duration: HOUR / 2, isFree: true,
            name, halfWidthName, shortName: StrUtil.deleteBrackets(halfWidthName),
            channelType: 'GR', channel: 'GR-1', ...values,
        });
    };
    await addProgram(1);
    const addHistory = async (values = {}) => source.getRepository(RecordedHistory).save({
        name: StrUtil.deleteBrackets(StrUtil.toHalf(NAME)), channelId: 1, endAt: NOW - HOUR, ...values,
    });
    const getReserve = async (programId = 1) => {
        const rows = await reserveDB.findProgramIds([programId]);
        assert.equal(rows.length, 1, `program ${programId} の予約は1件`);
        assert.equal(rows[0].ruleId, ruleId);
        return rows[0];
    };
    const assertRuleUnchanged = async () => {
        assert.equal((await ruleDB.findId(ruleId, true)).updateCnt, 0);
        assert.deepEqual(errors, [], '内部で握りつぶされたエラーがない');
        assert.equal(executionLocked, false, '更新完了後は実行権を解放する');
    };
    const getRuleReserve = async (id, programId = 1) => {
        const rows = (await reserveDB.findProgramIds([programId])).filter(row => row.ruleId === id && !row.isEventRelay);
        assert.equal(rows.length, 1, `rule ${id}, program ${programId} の予約は1件`);
        return rows[0];
    };
    return { source, model, ruleId, ruleDB, reserveDB, programDB, errors, addOtherRule, earlierOtherRuleId,
        getRuleReserve, addProgram, addHistory, getReserve, events, assertRuleUnchanged };
}

for (const scheduler of ['planner', 'legacy']) {
    for (const period of [7, undefined]) {
        const prefix = `${scheduler} / 期間${period === undefined ? '指定なし' : `${period}日`}`;
        test(`${prefix}: (1) 同名同局の録画履歴から [再] 番組を重複予約にする`, async t => {
            const h = await makeHarness(scheduler, period, t);
            await h.addHistory();
            await h.model.updateRule(h.ruleId);
            assert.equal((await h.getReserve()).isOverlap, true);
            await h.assertRuleUnchanged();
        });
        test(`${prefix}: (2) ルール更新なしで履歴追加後の updateRule が既存予約を重複へ更新する`, async t => {
            const h = await makeHarness(scheduler, period, t);
            await h.model.updateRule(h.ruleId);
            const before = await h.getReserve();
            assert.equal(before.isOverlap, false);
            await h.addHistory();
            await h.model.updateRule(h.ruleId);
            const after = await h.getReserve();
            assert.equal(after.id, before.id);
            assert.equal(after.isOverlap, true);
            assert.equal(after.ruleUpdateCnt, before.ruleUpdateCnt);
            assert.ok(h.events.at(-1).update.some(row => row.id === before.id && row.isOverlap === true));
            await h.assertRuleUnchanged();
        });
        test(`${prefix}: (3) updateAll が履歴追加後の既存予約を重複へ更新する`, async t => {
            const h = await makeHarness(scheduler, period, t);
            await h.model.updateRule(h.ruleId);
            const before = await h.getReserve();
            assert.equal(before.isOverlap, false);
            await h.addHistory();
            await h.model.updateAll();
            const after = await h.getReserve();
            assert.equal(after.id, before.id);
            assert.equal(after.isOverlap, true);
            assert.equal(after.ruleUpdateCnt, before.ruleUpdateCnt);
            await h.assertRuleUnchanged();
        });
        test(`${prefix}: (4) 番組更新の updateReservesByProgramIds で重複状態を維持する`, async t => {
            const h = await makeHarness(scheduler, period, t);
            await h.model.updateRule(h.ruleId);
            const before = await h.getReserve();
            assert.equal(before.isOverlap, false);
            await h.addHistory();
            await h.model.updateRule(h.ruleId);
            assert.equal((await h.getReserve()).isOverlap, true);
            await h.source.getRepository(Program).update(1, { updateTime: NOW + 1000 });
            await h.model.updateReservesByProgramIds([1]);
            const after = await h.getReserve();
            assert.equal(after.id, before.id);
            assert.equal(after.isOverlap, true);
            assert.equal(after.programUpdateTime, NOW + 1000, '早期 return せず番組情報を反映した');
            assert.equal(after.ruleUpdateCnt, before.ruleUpdateCnt);
            await h.assertRuleUnchanged();
        });
        test(`${prefix}: (5) 別局・名前違いは重複にせず、期間条件に従う`, async t => {
            const h = await makeHarness(scheduler, period, t);
            await h.addProgram(2, { channelId: 2, channel: 'GR-2' });
            await h.addProgram(3, { name: '重複除外検証 第2話[再]' });
            await h.addProgram(4, { name: '重複除外検証 期間外[再]' });
            await h.addProgram(5, {
                name: '重複除外検証 遠い再放送[再]', startAt: NOW + 8 * DAY, endAt: NOW + 8 * DAY + HOUR / 2,
            });
            await h.addHistory();
            await h.addHistory({ name: StrUtil.deleteBrackets(StrUtil.toHalf('重複除外検証 遠い再放送')) });
            await h.addHistory({ name: StrUtil.deleteBrackets(StrUtil.toHalf('重複除外検証 期間外')), endAt: NOW - 8 * DAY });
            await h.model.updateRule(h.ruleId);
            assert.equal((await h.getReserve(1)).isOverlap, true, '同名同局は陽性対照');
            assert.equal((await h.getReserve(2)).isOverlap, false, '別局');
            assert.equal((await h.getReserve(3)).isOverlap, false, '名前違い');
            assert.equal((await h.getReserve(4)).isOverlap, period === undefined,
                '期間指定なしは過去履歴を無期限に対象とする');
            assert.equal((await h.getReserve(5)).isOverlap, period === undefined,
                '最近の履歴でも再放送が履歴終了から期間を超える場合は重複にしない');
            await h.assertRuleUnchanged();
        });
    }
}


for (const scheduler of ['planner', 'legacy']) {
    for (const otherFirst of [false, true]) {
        test(`${scheduler}: (6) updateAll 1周で除外なしルールにも波及する (${otherFirst ? 'B先行' : 'A先行'})`, async t => {
            const h = await makeHarness(scheduler, 7, t, otherFirst);
            const otherId = h.earlierOtherRuleId ?? await h.addOtherRule();
            await h.addHistory();
            await h.model.updateAll();
            assert.equal((await h.getRuleReserve(h.ruleId)).isOverlap, true);
            assert.equal((await h.getRuleReserve(otherId)).isOverlap, true);
            await h.assertRuleUnchanged();
        });
    }
    test(`${scheduler}: (7) 波及先の重複解除は再評価後も保持する`, async t => {
        const h = await makeHarness(scheduler, 7, t);
        const otherId = await h.addOtherRule();
        await h.addHistory();
        await h.model.updateAll();
        await h.model.removeOverlap((await h.getRuleReserve(otherId)).id);
        await h.model.updateRule(h.ruleId);
        await h.model.updateAll();
        const other = await h.getRuleReserve(otherId);
        assert.equal(other.isOverlap, false);
        assert.equal(other.isIgnoreOverlap, true);
        assert.equal((await h.getRuleReserve(h.ruleId)).isOverlap, true);
        await h.assertRuleUnchanged();
    });
    for (const reason of ['削除', '無効化', '条件変更', '履歴期限切れ', '波及元の重複解除']) {
        test(`${scheduler}: (8) ${reason}で波及先を通常予約へ戻す`, async t => {
            const h = await makeHarness(scheduler, 7, t, true);
            const otherId = h.earlierOtherRuleId;
            await h.addHistory();
            await h.model.updateAll();
            assert.equal((await h.getRuleReserve(otherId)).isOverlap, true);
            if (reason === '削除') await h.ruleDB.deleteOnce(h.ruleId);
            else if (reason === '無効化') await h.ruleDB.disableOnce(h.ruleId);
            else if (reason === '条件変更') {
                const rule = await h.ruleDB.findId(h.ruleId);
                rule.searchOption.keyword = '一致しない番組';
                await h.ruleDB.updateOnce(rule);
            } else if (reason === '履歴期限切れ') {
                await h.source.getRepository(RecordedHistory).update({ channelId: 1 }, { endAt: NOW - 8 * DAY });
            } else {
                await h.model.removeOverlap((await h.getRuleReserve(h.ruleId)).id);
            }
            await h.model.updateAll();
            if (reason === '波及元の重複解除') {
                await h.model.updateAll();
                const remaining = await h.reserveDB.findProgramIds([1]);
                assert.equal(remaining.length, 1, '同じ番組の通常予約を1件にまとめて二重録画を防ぐ');
                assert.ok(remaining.every(row => row.isOverlap === false), '再評価を繰り返しても重複が復活しない');
                const source = remaining.find(row => row.ruleId === h.ruleId);
                assert.ok(source, '解除したA予約を保持する');
                assert.equal(source.isIgnoreOverlap, true);
            } else {
                assert.equal((await h.getRuleReserve(otherId)).isOverlap, false);
            }
        });
    }
    test(`${scheduler}: (9) updateRule(A) だけで既存B予約へ即時波及する`, async t => {
        const h = await makeHarness(scheduler, 7, t);
        const otherId = await h.addOtherRule();
        await h.model.updateRule(otherId);
        const before = await h.getRuleReserve(otherId);
        assert.equal(before.isOverlap, false);
        await h.addHistory();
        await h.model.updateRule(h.ruleId);
        const after = await h.getRuleReserve(otherId);
        assert.equal(after.id, before.id);
        assert.equal(after.isOverlap, true);
        assert.equal((await h.getRuleReserve(h.ruleId)).isOverlap, true);
        await h.assertRuleUnchanged();
    });
    test(`${scheduler}: (10) 手動予約とイベントリレー予約へ波及しない`, async t => {
        const h = await makeHarness(scheduler, 7, t);
        const otherId = await h.addOtherRule();
        await h.model.updateRule(otherId);
        const template = await h.getRuleReserve(otherId);
        const { id, ...values } = template;
        const manual = await h.source.getRepository(Reserve).save({ ...values, ruleId: null, ruleUpdateCnt: null });
        const relay = await h.source.getRepository(Reserve).save({ ...values, ruleId: otherId, isEventRelay: true });
        await h.addHistory();
        await h.model.updateRule(h.ruleId);
        assert.equal((await h.reserveDB.findId(manual.id)).isOverlap, false);
        assert.equal((await h.reserveDB.findId(relay.id)).isOverlap, false);
        assert.equal((await h.getRuleReserve(otherId)).isOverlap, true, '通常の他ルール予約は陽性対照');
        await h.assertRuleUnchanged();
    });
}


for (const scheduler of ['planner', 'legacy']) {
    for (const otherFirst of [false, true]) {
        test(`${scheduler}: updateAll は先行済みの関連ルールだけを後段で再評価する (${otherFirst ? 'B先行' : 'A先行'})`, async t => {
            const h = await makeHarness(scheduler, 7, t, otherFirst);
            const otherId = h.earlierOtherRuleId ?? await h.addOtherRule();
            await h.addHistory();
            const calls = new Map();
            const originalFindRuleId = h.reserveDB.findRuleId.bind(h.reserveDB);
            h.reserveDB.findRuleId = async option => {
                calls.set(option.ruleId, (calls.get(option.ruleId) ?? 0) + 1);
                return originalFindRuleId(option);
            };
            await h.model.updateAll();
            assert.equal(calls.get(h.ruleId), 1, '波及元 A は1回評価');
            assert.equal(calls.get(otherId), otherFirst ? 2 : 1,
                otherFirst ? '先に評価した B のみ A の変更後に再評価' : '後続 B は A の結果を同じ周回で読む');
            assert.equal((await h.getRuleReserve(otherId)).isOverlap, true);
            await h.assertRuleUnchanged();
        });
    }

    test(`${scheduler}: 録画完了時は予約行がない同局・同名ルールも検索して再評価する`, async t => {
        const h = await makeHarness(scheduler, 7, t);
        await h.addHistory();
        assert.deepEqual(await h.reserveDB.findProgramIds([1]), [], '再評価前は予約行がない');
        const program = await h.source.getRepository(Program).findOneByOrFail({ id: 1 });
        await h.model.updateRulesByChannelAndShortName(program.channelId, program.shortName);
        assert.equal((await h.getRuleReserve(h.ruleId)).isOverlap, true);
        await h.assertRuleUnchanged();
    });

    test(`${scheduler}: 同名番組が検索結果になくても録画元ルールを再評価する`, async t => {
        const h = await makeHarness(scheduler, 7, t);
        const program = await h.source.getRepository(Program).findOneByOrFail({ id: 1 });
        program.endAt = NOW - HOUR;
        await h.source.getRepository(Program).save(program);
        const reevaluated = [];
        h.model.updateRule = async ruleId => { reevaluated.push(ruleId); };
        await h.model.updateRulesByChannelAndShortName(program.channelId, program.shortName, [h.ruleId]);
        assert.deepEqual(reevaluated, [h.ruleId]);
    });

    test(`${scheduler}: 同名一致した録画元ルールは1回だけ再評価する`, async t => {
        const h = await makeHarness(scheduler, 7, t);
        const program = await h.source.getRepository(Program).findOneByOrFail({ id: 1 });
        const reevaluated = [];
        h.model.updateRule = async ruleId => { reevaluated.push(ruleId); };
        await h.model.updateRulesByChannelAndShortName(program.channelId, program.shortName, [h.ruleId]);
        assert.deepEqual(reevaluated, [h.ruleId]);
    });

    test(`${scheduler}: 局候補の DB 検索は明示的な別局ルールを除外する`, async t => {
        const h = await makeHarness(scheduler, 7, t);
        const localId = await h.ruleDB.insertOnce({
            isTimeSpecification: false,
            searchOption: { keyword: '重複除外検証', name: true, channelIds: [1] },
            reserveOption: { enable: true, avoidDuplicate: false },
        });
        const otherId = await h.ruleDB.insertOnce({
            isTimeSpecification: false,
            searchOption: { keyword: '重複除外検証', name: true, channelIds: [11] },
            reserveOption: { enable: true, avoidDuplicate: false },
        });
        const candidates = await h.ruleDB.findCandidateIdsByChannelId(1);
        assert.ok(candidates.includes(h.ruleId), '局指定なしは候補に含める');
        assert.ok(candidates.includes(localId), '対象局の明示指定を含める');
        assert.equal(candidates.includes(otherId), false, '局 ID の部分一致を避けて別局を除外する');
    });

    test(`${scheduler}: updateAll は各ルールの番組検索結果を実行中だけ共有する`, async t => {
        const h = await makeHarness(scheduler, 7, t);
        await h.addOtherRule();
        let findRuleCount = 0;
        const originalFindRule = h.programDB.findRule.bind(h.programDB);
        h.programDB.findRule = async option => {
            findRuleCount++;
            return originalFindRule(option);
        };
        await h.model.updateAll();
        assert.equal(findRuleCount, 2, '2ルール各1回。波及元としての再検索をしない');
        await h.model.updateAll();
        assert.equal(findRuleCount, 4, '次の updateAll では新しいキャッシュを作る');
    });

    test(`${scheduler}: 重複解除は関連ルール再評価が失敗しても成功を返す`, async t => {
        const h = await makeHarness(scheduler, 7, t);
        const otherId = await h.addOtherRule();
        await h.addHistory();
        await h.model.updateAll();
        const reserve = await h.getRuleReserve(otherId);
        h.programDB.findRule = async () => { throw new Error('synthetic findRule failure'); };
        await assert.doesNotReject(h.model.removeOverlap(reserve.id));
        assert.equal((await h.reserveDB.findId(reserve.id)).isIgnoreOverlap, true);
        assert.ok(h.errors.length > 0, '関連再評価失敗をログへ残す');
    });

    test(`${scheduler}: 手動録画完了イベントで同局同名ルールを即時に再評価する`, async t => {
        const h = await makeHarness(scheduler, 7, t);
        await h.addProgram(2, { channelId: 2, channel: 'GR-2' });
        await h.model.updateRule(h.ruleId);
        const before = await h.getReserve();
        assert.equal(before.isOverlap, false);
        const { id, ...values } = before;
        const manual = await h.source.getRepository(Reserve).save({
            ...values, ruleId: null, ruleUpdateCnt: null, programId: 99,
            startAt: NOW - HOUR, endAt: NOW - HOUR / 2,
        });
        // recEnd が保存した履歴を実 sqlite に置き、その後の finish イベントを検証する。
        await h.addHistory();
        let finishHandler;
        const noopEvent = () => new Proxy({}, { get: () => () => {} });
        const recordingEvent = new Proxy({}, { get: (_target, key) => key === 'setFinishRecording'
            ? callback => { finishHandler = callback; } : () => {} });
        const errors = [];
        const logger = { getLogger: () => ({ system: {
            info() {}, debug() {}, warn() {}, fatal() {}, error: value => errors.push(value),
        } }) };
        const setter = new EventSetter(
            logger, noopEvent(), noopEvent(), noopEvent(), noopEvent(), recordingEvent,
            noopEvent(), noopEvent(), noopEvent(), h.model, {}, {}, {}, {},
            { addRecordingFinishCmd() {} }, { notifyClient() {} }, { getConfig: () => ({ recorded: [] }) },
            { dispatch: async () => {} }, { resolve: async () => {} }, {}, {}, {},
            { onChange() {} }, {}, { start() {} }, h.reserveDB,
        );
        setter.set();
        await finishHandler(manual, {
            id: 99, name: NAME, channelId: 1, startAt: manual.startAt,
            endAt: manual.endAt, recordingStatus: 'completed',
        }, true);
        await waitUntil(async () => (await h.getReserve()).isOverlap === true);
        assert.equal(await h.reserveDB.findId(manual.id), null, '終了した手動予約は削除する');
        assert.equal((await h.getReserve()).id, before.id);
        assert.equal((await h.getReserve()).isOverlap, true, '周期 updateAll を呼ばず再放送を重複にする');
        assert.equal((await h.getReserve(2)).isOverlap, false, '別局の予約は重複にしない');
        assert.deepEqual(errors, []);
        await h.assertRuleUnchanged();
    });
}
