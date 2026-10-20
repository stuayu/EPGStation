const test = require('node:test');
const assert = require('node:assert/strict');
const { VIDEO_SHORTCUTS, isListedVideoShortcut } = require('../../dist/util/VideoShortcutUtil');
const { isCommercialChapter } = require('../../dist/util/CommercialChapterUtil');

test('CM chapter matching trims whitespace and ignores case', () => {
    assert.equal(isCommercialChapter({ title: '  cM 前半' }), true);
    assert.equal(isCommercialChapter({ title: '本編 CM' }), false);
    assert.equal(isCommercialChapter({ title: null }), false);
});

test('shortcut handler accepts only key combinations represented in the help table', () => {
    assert.equal(isListedVideoShortcut({ key: 'ArrowLeft', ctrlKey: false, shiftKey: false }), true);
    assert.equal(isListedVideoShortcut({ key: 'ArrowRight', ctrlKey: true, shiftKey: false }), true);
    assert.equal(isListedVideoShortcut({ key: 'ArrowLeft', ctrlKey: false, shiftKey: true }), true);
    assert.equal(isListedVideoShortcut({ key: 'ArrowUp', ctrlKey: false, shiftKey: false }), false);
    assert.equal(isListedVideoShortcut({ key: 'C', ctrlKey: false, shiftKey: true }), true);
    assert.equal(isListedVideoShortcut({ key: 'z', ctrlKey: false, shiftKey: false }), false);
});

test('shortcut help table documents each custom shortcut once', () => {
    const keys = VIDEO_SHORTCUTS.map(item => item.keys);
    assert.equal(new Set(keys).size, keys.length);
    for (const key of ['Space', '← / →', 'Ctrl + ← / →', 'Shift + ← / →', ',', '.', '[ / ]', 'c', 'i', '+ / -', '?']) {
        assert.ok(keys.includes(key), `missing shortcut ${key}`);
    }
});
