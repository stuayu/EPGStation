'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const RuleManageModel = require('../../dist/model/operator/rule/RuleManageModel').default;
const ReserveOptionChecker = require('../../dist/model/operator/ReserveOptionChecker').default;

function createModel(insertOnce) {
    const events = [];
    const logger = { getLogger: () => ({ system: { info() {}, error() {} } }) };
    const model = new RuleManageModel(logger, { checkRuleOption: () => true }, { insertOnce, findId: async () => null }, { emitAdded: id => events.push(id) });
    return { model, events };
}

test('ルール DB の追加失敗は API 呼び出し元へ伝播し、追加通知を送らない', async () => {
    const failure = new Error('insert failed');
    const { model, events } = createModel(async () => { throw failure; });
    await assert.rejects(model.add({}), error => error === failure);
    assert.deepEqual(events, []);
});

test('ルール追加中の更新は追加完了後に実行する', async () => {
    let completeInsert;
    const order = [];
    const events = [];
    const logger = { getLogger: () => ({ system: { info() {}, error() {} } }) };
    const ruleDB = {
        insertOnce: () => {
            order.push('insert-start');
            return new Promise(resolve => {
                completeInsert = () => {
                    order.push('insert-end');
                    resolve(1);
                };
            });
        },
        findId: async () => {
            order.push('find-id');
            return { id: 2 };
        },
        updateOnce: async () => { order.push('update'); },
    };
    const model = new RuleManageModel(logger, { checkRuleOption: () => true }, ruleDB, {
        emitAdded: id => events.push(id),
        emitUpdated: id => events.push(`updated:${id}`),
    });
    const adding = model.add({});
    await new Promise(resolve => setImmediate(resolve));
    const updating = model.update({ id: 2 });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, ['insert-start']);
    completeInsert();
    await Promise.all([adding, updating]);
    assert.deepEqual(order, ['insert-start', 'insert-end', 'find-id', 'update']);
});

test('自動予約ルールの fuzzy キーワード指定は RuleOption validation を通る', () => {
    const checker = new ReserveOptionChecker({ getConfig: () => ({}) });
    assert.equal(checker.checkRuleOption({
        isTimeSpecification: false,
        searchOption: { keyword: 'ÉTÉ', name: true, isFuzzy: true },
        reserveOption: { enable: true },
    }), true);
});
