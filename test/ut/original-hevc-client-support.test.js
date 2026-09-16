const test = require('node:test');
const assert = require('node:assert');

const {
    checkOfflineOriginalHevcClientSupport,
    checkOriginalHevcClientSupport,
    UNSUPPORTED_HEVC_REASON,
    WEBKIT_MAIN10_REASON,
} = require('../../dist/util/OriginalHevcClientSupport');

test('mpegts.js が HEVC を扱えない端末は無変換再生の対象外', () => {
    const r = checkOriginalHevcClientSupport({ mseH265Playback: false, isWebKitEngine: false, sourceBitDepth: 8 });
    assert.equal(r.isSupported, false);
    assert.equal(r.reason, UNSUPPORTED_HEVC_REASON);
});

test('WebKit で 10bit 素材は無変換再生の対象外にする', () => {
    // 実測: iPad で Main 10 の録画を無変換再生するとコマ送りになる
    const r = checkOriginalHevcClientSupport({ mseH265Playback: true, isWebKitEngine: true, sourceBitDepth: 10 });
    assert.equal(r.isSupported, false);
    assert.equal(r.reason, WEBKIT_MAIN10_REASON);
});

test('WebKit でも 8bit 素材は無変換再生できる', () => {
    const r = checkOriginalHevcClientSupport({ mseH265Playback: true, isWebKitEngine: true, sourceBitDepth: 8 });
    assert.equal(r.isSupported, true);
    assert.equal(r.reason, null);
});

test('WebKit 以外は 10bit でも無変換再生できる', () => {
    // PC の Chrome では同じ素材が平均 30.5fps で再生できている
    const r = checkOriginalHevcClientSupport({ mseH265Playback: true, isWebKitEngine: false, sourceBitDepth: 10 });
    assert.equal(r.isSupported, true);
});

test('ビット深度が分からない場合は従来どおり許可する', () => {
    const r = checkOriginalHevcClientSupport({ mseH265Playback: true, isWebKitEngine: true });
    assert.equal(r.isSupported, true);
});

test('オフライン保存は WebKit の 10bit 素材でも無変換候補を残す', () => {
    const r = checkOfflineOriginalHevcClientSupport({ mseH265Playback: true });
    assert.equal(r.isSupported, true);
});

test('オフライン保存も mpegts.js が HEVC を扱えない端末では候補から外す', () => {
    const r = checkOfflineOriginalHevcClientSupport({ mseH265Playback: false });
    assert.equal(r.isSupported, false);
    assert.equal(r.reason, UNSUPPORTED_HEVC_REASON);
});
