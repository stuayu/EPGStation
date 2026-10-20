const test = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { createChapterText, detectCmIntervals, parseSilenceDetectOutput } = require('../../dist/util/CmDetectUtil');
const CmDetectionManageModel = require('../../dist/model/operator/cmDetection/CmDetectionManageModel').default;

test('parses silencedetect output with Windows newlines and ignores incomplete intervals', () => {
    assert.deepEqual(parseSilenceDetectOutput('[silencedetect] silence_start: 12.0\r\n[silencedetect] silence_end: 13.0 | silence_duration: 1\r\n[silencedetect] silence_start: 20\r\n'), [{ start: 12, end: 13 }]);
});

test('設定無効時は投入せず、有効時の同一 videoFile は重複キュー登録しない', () => {
    const tasks = [];
    let enabled = false;
    const model = new CmDetectionManageModel(
        { getLogger: () => ({ system: { info() {}, warn() {}, error() {} } }) },
        { getConfig: () => ({ cmDetection: { enabled } }) },
        { add: task => tasks.push(task) },
        {},
        {},
    );
    model.add(12);
    assert.equal(tasks.length, 0);
    enabled = true;
    model.add(12);
    model.add(12);
    assert.equal(tasks.length, 1);
});

test('detects a 30 second commercial block within tolerance, excluding head and tail', () => {
    const silences = [{ start: 9.5, end: 10.5 }, { start: 24.5, end: 25.5 }, { start: 39.5, end: 40.5 }];
    assert.deepEqual(detectCmIntervals(60, silences), [{ start: 10, end: 40 }]);
});

test('15 秒未満の短い内部区間を CM と誤判定しない', () => {
    assert.deepEqual(detectCmIntervals(60, [{ start: 9.6, end: 10.4 }, { start: 10.1, end: 10.9 }]), []);
});

test('accepts tolerance boundary, rejects overlong runs, and writes CM chapters', () => {
    assert.deepEqual(detectCmIntervals(70, [{ start: 9.5, end: 10.5 }, { start: 25.1, end: 26.1 }, { start: 39.9, end: 40.9 }]), [{ start: 10, end: 40.4 }]);
    const many = Array.from({ length: 13 }, (_, i) => ({ start: i * 15 + 14.7, end: i * 15 + 15.3 }));
    assert.deepEqual(detectCmIntervals(210, many), []);
    assert.match(createChapterText(60, [{ start: 10, end: 40 }]), /CHAPTER02NAME=CM/);
    assert.match(createChapterText(60, [{ start: 10, end: 40 }]), /CHAPTER03NAME=本編/);
});
