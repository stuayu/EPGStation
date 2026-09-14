const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    decideMpegTsLifecycle,
    destroyDeferredDPlayerMediaBackend,
    destroyMpegtsBeforeVideoReuse,
    shouldDeferMpegtsDestroy,
    takeDPlayerMediaBackendDestroy,
} = require('../../dist/util/MpegTsLifecycleUtil.js');
const { findPlaybackUrl, requirePlaybackUrl } = require('../../dist/util/PlaybackUrlUtil.js');

test('実際の DPlayer 1.33.1 は backend callback を1回実行し、mpegts を unload/detach/destroy する', () => {
    const packageJson = require('../../client/node_modules/dplayer/package.json');
    const source = fs.readFileSync(path.resolve(__dirname, '../../client/node_modules/dplayer/dist/DPlayer.min.js'), 'utf8');

    assert.equal(packageJson.version, '1.33.1');
    assert.match(source, /destroyMediaBackend\(\)\{const e=this\.mediaBackendDestroy;this\.mediaBackendDestroy=null,e\?\.\(\)\}/u);
    assert.match(source, /t\.unload\(\),t\.detachMediaElement\(\),t\.destroy\(\)/u);
    assert.match(source, /this\.plugins\.mpeg2toh264===a&&delete this\.plugins\.mpeg2toh264/u);
});

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

test('DPlayer 1.33 の reset は mediaBackendDestroy を1回だけ実行し、後続 initMSE で再実行しない', () => {
    const video = {};
    const events = [];
    const player = {
        _media_element: video,
        unload: () => events.push('unload'),
        detachMediaElement: () => events.push('detach'),
        destroy: () => events.push('destroy'),
    };
    const dplayer = {
        plugins: { mpegts: player },
        mediaBackendDestroy: () => {
            player.unload();
            player.detachMediaElement();
            player.destroy();
            if (dplayer.plugins.mpegts === player) delete dplayer.plugins.mpegts;
        },
        destroyMediaBackend: () => {
            const destroy = dplayer.mediaBackendDestroy;
            dplayer.mediaBackendDestroy = null;
            destroy?.();
        },
    };

    assert.equal(destroyMpegtsBeforeVideoReuse(player, video, dplayer), true);
    assert.doesNotThrow(() => dplayer.destroyMediaBackend());
    assert.deepEqual(events, ['unload', 'detach', 'destroy']);
    assert.equal(dplayer.mediaBackendDestroy, null);
});

test('DPlayer 1.33 の defer は旧 callback を canplay 後まで保持し、新 backend を破棄しない', () => {
    const oldPlayer = { unload: 0, detach: 0, destroy: 0 };
    const newPlayer = { unload: 0, detach: 0, destroy: 0 };
    const oldCaption = { dispose: 0 };
    const newCaption = { dispose: 0 };
    const dplayer = {
        plugins: { mpegts: oldPlayer, aribb24Caption: oldCaption },
        mediaBackendDestroy: () => {
            dplayer.plugins.aribb24Caption?.dispose === undefined || dplayer.plugins.aribb24Caption.dispose++;
            dplayer.plugins.mpegts?.unload === undefined || dplayer.plugins.mpegts.unload++;
            dplayer.plugins.mpegts?.detach === undefined || dplayer.plugins.mpegts.detach++;
            dplayer.plugins.mpegts?.destroy === undefined || dplayer.plugins.mpegts.destroy++;
        },
        destroyMediaBackend: () => {
            const destroy = dplayer.mediaBackendDestroy;
            dplayer.mediaBackendDestroy = null;
            destroy?.();
        },
    };
    // 上の callback は DPlayer 1.33 の this.plugins 参照を模倣する。
    oldPlayer.unload = oldPlayer.detach = oldPlayer.destroy = 0;
    newPlayer.unload = newPlayer.detach = newPlayer.destroy = 0;
    dplayer.plugins.mpegts = newPlayer;
    dplayer.plugins.aribb24Caption = newCaption;

    const oldDestroy = takeDPlayerMediaBackendDestroy(dplayer);
    dplayer.destroyMediaBackend();
    assert.equal(oldDestroy !== null, true);
    assert.deepEqual([oldPlayer.unload, oldPlayer.detach, oldPlayer.destroy, oldCaption.dispose], [0, 0, 0, 0]);

    destroyDeferredDPlayerMediaBackend(dplayer, oldDestroy, { mpegts: oldPlayer, aribb24Caption: oldCaption });
    assert.deepEqual([oldPlayer.unload, oldPlayer.detach, oldPlayer.destroy, oldCaption.dispose], [1, 1, 1, 1]);
    assert.deepEqual([newPlayer.unload, newPlayer.detach, newPlayer.destroy, newCaption.dispose], [0, 0, 0, 0]);
    assert.equal(dplayer.plugins.mpegts, newPlayer);
    assert.equal(dplayer.plugins.aribb24Caption, newCaption);
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
