const test = require('node:test');
const assert = require('node:assert/strict');
const { VIDEO_SHORTCUTS, isCaptureShortcut, isListedVideoShortcut } = require('../../dist/util/VideoShortcutUtil');
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
    assert.equal(isListedVideoShortcut({ key: 'f', ctrlKey: true, shiftKey: false }), false);
    assert.equal(isListedVideoShortcut({ key: 'c', ctrlKey: true, shiftKey: false }), false);
    assert.equal(isListedVideoShortcut({ key: 'ArrowRight', ctrlKey: false, shiftKey: false, altKey: true }), false);
    assert.equal(isListedVideoShortcut({ key: 'ArrowRight', ctrlKey: false, shiftKey: false, metaKey: true }), false);
    assert.equal(isListedVideoShortcut({ key: 'ArrowUp', ctrlKey: false, shiftKey: true }), false);
    assert.equal(isListedVideoShortcut({ key: 'ArrowLeft', ctrlKey: true, shiftKey: true }), false);
});

test('capture shortcut is Shift+C and rejects plain C or Ctrl+Shift+C', () => {
    assert.equal(isCaptureShortcut({ key: 'C', ctrlKey: false, shiftKey: true }), true);
    assert.equal(isCaptureShortcut({ key: 'c', ctrlKey: false, shiftKey: true }), true);
    assert.equal(isCaptureShortcut({ key: 'c', ctrlKey: false, shiftKey: false }), false);
    assert.equal(isCaptureShortcut({ key: 'C', ctrlKey: true, shiftKey: true }), false);
});

test('shortcut help table documents each custom shortcut once', () => {
    const keys = VIDEO_SHORTCUTS.map(item => item.keys);
    assert.equal(new Set(keys).size, keys.length);
    for (const key of ['Space', '← / →', 'Ctrl + ← / →', 'Shift + ← / →', ',', '.', '[ / ]', 'c', 'i', '+ / -', '?']) {
        assert.ok(keys.includes(key), `missing shortcut ${key}`);
    }
});

test('一覧の全ショートカット表記が対応する実キーイベントで認識される', () => {
    const events = [
        ['Space', ' ', false, false],
        ['← / →', 'ArrowLeft', false, false],
        ['Ctrl + ← / →', 'ArrowRight', true, false],
        ['Shift + ← / →', 'ArrowLeft', false, true],
        ['Ctrl + ↑ / ↓', 'ArrowUp', true, false],
        ['Q', 'q', false, false],
        ['F', 'f', false, false],
        ['E', 'e', false, false],
        ['Shift + C', 'C', false, true],
        ['D', 'd', false, false],
        ['+ / -', '+', false, true],
        [',', ',', false, false],
        ['.', '.', false, false],
        ['[ / ]', ']', false, false],
        ['c', 'c', false, false],
        ['i', 'i', false, false],
        ['?', '?', false, true],
    ];
    for (const [label, key, ctrlKey, shiftKey] of events) {
        assert.ok(
            VIDEO_SHORTCUTS.some(shortcut => shortcut.keys === label),
            `missing ${label}`,
        );
        assert.equal(isListedVideoShortcut({ key, ctrlKey, shiftKey }), true, label);
    }
});
