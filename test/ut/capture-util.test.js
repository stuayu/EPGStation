const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createCaptureCommentInstructions,
    createCaptureFilename,
    getCaptureLayerOrder,
    getCaptureScale,
} = require('../../dist/util/CaptureUtil');

test('capture scaling maps display dimensions to video resolution', () => {
    assert.deepEqual(getCaptureScale(1920, 1080, 960, 540), { x: 2, y: 2 });
    assert.deepEqual(getCaptureScale(1920, 1080, 0, 540), { x: 1, y: 2 });
});

test('capture filename sanitizes title and uses local date time', () => {
    assert.equal(createCaptureFilename('News/Live', new Date(2026, 9, 20, 1, 2, 3)), 'News_Live_20261020-010203.jpg');
});

test('capture order always draws video then enabled overlays', () => {
    assert.deepEqual(getCaptureLayerOrder('caption-comment', true, true), ['video', 'caption', 'comments']);
    assert.deepEqual(getCaptureLayerOrder('caption-comment', false, true), ['video', 'comments']);
    assert.deepEqual(getCaptureLayerOrder('video', true, true), ['video']);
});

test('danmaku DOM data scales coordinates, font, and outline', () => {
    assert.deepEqual(
        createCaptureCommentInstructions(
            [{ text: ' hello ', left: 10, top: 5, color: 'red', fontSize: 20, strokeColor: 'black', strokeWidth: 1 }],
            { x: 2, y: 3 },
        ),
        [{ text: 'hello', x: 20, y: 75, color: 'red', fontSize: 60, strokeColor: 'black', strokeWidth: 3 }],
    );
});
