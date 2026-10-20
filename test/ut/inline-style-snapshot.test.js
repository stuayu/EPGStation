const test = require('node:test');
const assert = require('node:assert/strict');
const { captureInlineStyles, restoreInlineStyles } = require('../../dist/util/InlineStyleSnapshot');

const makeElement = (values = {}) => ({
    style: { width: '', height: '', transform: '', transformOrigin: '', display: '', visibility: '', ...values },
});

test('BML 対象 style だけを移動前へ戻し、移動中に増えた子の対象 style を解除する', () => {
    const parent = makeElement({ width: '37px', transform: 'rotate(2deg)' });
    const video = makeElement({ width: '320px', display: 'block' });
    const snapshot = captureInlineStyles([parent, video]);
    parent.style.width = '100%';
    parent.style.color = 'red';
    video.style.width = '100%';
    const recreatedCaption = makeElement({
        width: '100%',
        height: '100%',
        transform: 'scale(2)',
        transformOrigin: 'center',
        display: 'none',
        visibility: 'hidden',
    });

    restoreInlineStyles(snapshot, [parent, video, recreatedCaption]);
    assert.equal(parent.style.width, '37px');
    assert.equal(parent.style.transform, 'rotate(2deg)');
    assert.equal(parent.style.color, 'red');
    assert.equal(video.style.width, '320px');
    assert.equal(video.style.display, 'block');
    assert.deepEqual(
        [
            recreatedCaption.style.width,
            recreatedCaption.style.height,
            recreatedCaption.style.transform,
            recreatedCaption.style.transformOrigin,
            recreatedCaption.style.display,
            recreatedCaption.style.visibility,
        ],
        ['', '', '', '', '', ''],
    );
});
