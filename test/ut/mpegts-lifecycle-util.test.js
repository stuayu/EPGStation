const assert = require('node:assert/strict');
const test = require('node:test');

const {
    decideMpegTsLifecycle,
    destroyMpegtsBeforeVideoReuse,
    shouldDeferMpegtsDestroy,
} = require('../../dist/util/MpegTsLifecycleUtil.js');
const { findPlaybackUrl, requirePlaybackUrl } = require('../../dist/util/PlaybackUrlUtil.js');

test('同じ video 要素を再利用する切替では旧 mpegts.js を保持しない', () => {
    const video = {};

    assert.equal(decideMpegTsLifecycle({ _media_element: video }, video), 'reset');
    assert.equal(shouldDeferMpegtsDestroy(video, video), false);
});

test('画質切替の別 video 要素では旧 mpegts.js を保持できる', () => {
    assert.equal(decideMpegTsLifecycle({ _media_element: {} }, {}), 'defer');
    assert.equal(shouldDeferMpegtsDestroy({}, {}), true);
});

test('旧 video 要素を取得できない実装では安全側に即時破棄する', () => {
    assert.equal(decideMpegTsLifecycle({ _media_element: undefined }, {}), 'reset');
    assert.equal(shouldDeferMpegtsDestroy(undefined, {}), false);
    assert.equal(shouldDeferMpegtsDestroy(null, {}), false);
});

test('旧インスタンスが無ければ新しい MediaSource を作る', () => {
    assert.equal(decideMpegTsLifecycle(undefined, {}), 'create');
});

test('同じ video 要素では新しい src 設定より先に旧 mpegts.js を破棄する', () => {
    const video = {};
    const events = [];
    const player = {
        _media_element: video,
        destroy: () => events.push('destroy'),
    };

    assert.equal(destroyMpegtsBeforeVideoReuse(player, video), true);
    events.push('src');
    assert.deepEqual(events, ['destroy', 'src']);
});

test('別 video 要素では旧 mpegts.js を破棄せず保持する', () => {
    const events = [];
    const player = {
        _media_element: {},
        destroy: () => events.push('destroy'),
    };

    assert.equal(destroyMpegtsBeforeVideoReuse(player, {}), false);
    assert.deepEqual(events, []);
});

test('空の video src より DPlayer の設定 URL を優先して画質リストへ引き継ぐ', () => {
    assert.equal(findPlaybackUrl('https://example.test/recorded.m2ts', ''), 'https://example.test/recorded.m2ts');
    assert.equal(findPlaybackUrl('', 'https://example.test/recorded.m2ts'), 'https://example.test/recorded.m2ts');
});

test('DPlayer 内部の blob URL は配信元 URL として再利用しない', () => {
    assert.equal(findPlaybackUrl('blob:https://example.test/internal', './api/streams/live/1/m2tsll'), './api/streams/live/1/m2tsll');
});

test('mpegts.js 初期化 URL が空なら例外にする', () => {
    assert.throws(() => requirePlaybackUrl(undefined, 'mpegts.js initialization'), /playback URL is empty/);
    assert.throws(() => requirePlaybackUrl('', 'mpegts.js initialization'), /playback URL is empty/);
});
