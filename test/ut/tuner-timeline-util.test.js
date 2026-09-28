'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { getTunerTimelineItem } = require('../../dist/util/TunerTimelineUtil');

test('時間軸の予約位置をパーセントへ変換し範囲外を切り詰める', () => {
    assert.deepEqual(getTunerTimelineItem(25, 75, 0, 100), { left: 25, width: 50 });
    assert.deepEqual(getTunerTimelineItem(-10, 20, 0, 100), { left: 0, width: 20 });
    assert.equal(getTunerTimelineItem(100, 110, 0, 100), null);
});
