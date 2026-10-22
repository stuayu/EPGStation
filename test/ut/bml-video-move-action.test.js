const test = require('node:test');
const assert = require('node:assert/strict');
const { getBmlVideoMoveAction } = require('../../dist/util/BmlVideoMoveAction');

test('文書遷移で移動済み映像が新しい video object に無ければ再移動する', () => {
    assert.equal(getBmlVideoMoveAction(true, false, true), 'moveToBml');
});

test('現在の video object が映像を含む場合は何もしない', () => {
    assert.equal(getBmlVideoMoveAction(true, true, true), 'none');
});

test('映像を BML へ移動する前に video object が無い場合は何もしない', () => {
    assert.equal(getBmlVideoMoveAction(false, false, false), 'none');
});

test('BML 側へ移動済みで新しい video object が無ければ DPlayer へ戻す', () => {
    assert.equal(getBmlVideoMoveAction(true, false, false), 'moveToDPlayer');
});
