const test = require('node:test');
const assert = require('node:assert/strict');
const { getBmlVideoResizeElements } = require('../../dist/util/BmlVideoResizeElements');

const node = parentElement => ({ parentElement });

test('video と mediaElement の間にある wrapper をサイズ調整対象へ含める', () => {
    const media = node(null);
    const wrapper = node(media);
    const video = node(wrapper);

    assert.deepEqual(getBmlVideoResizeElements(media, video), [wrapper, video]);
});

test('video が直下なら従来どおり video だけを対象にする', () => {
    const media = node(null);
    const video = node(media);

    assert.deepEqual(getBmlVideoResizeElements(media, video), [video]);
});

test('mediaElement 配下にない video は対象にしない', () => {
    const media = node(null);
    const elsewhere = node(null);
    const video = node(elsewhere);

    assert.deepEqual(getBmlVideoResizeElements(media, video), []);
});
