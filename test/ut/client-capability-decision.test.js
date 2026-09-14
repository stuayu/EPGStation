'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { isNativeHlsPlayback, resolveDecodeSupport, resolveDisplayCapabilities } = require('../../dist/util/ClientCapabilityDecision');

test('iPhone 相当は MSE 無しのネイティブ HLS と Main10 SDR の canPlayType を採用する', () => {
    assert.equal(isNativeHlsPlayback({ hlsCanPlayType: 'probably', isIos: true, isSafari: false }), true);
    assert.equal(resolveDecodeSupport({ nativeHls: true, mediaCapabilitiesSupported: false, canPlayType: 'probably' }), true);
});

test('iPhone 相当では HDR 非対応を Main10 SDR 対応と混同しない', () => {
    assert.equal(resolveDecodeSupport({ nativeHls: true, mediaCapabilitiesSupported: false, canPlayType: 'maybe' }), true);
    assert.deepEqual(resolveDisplayCapabilities(false), { hdr: false, hlg: false });
});

test('iPad / Mac Safari 相当も native HLS、Chromium 相当は MSE を使う', () => {
    assert.equal(isNativeHlsPlayback({ hlsCanPlayType: 'maybe', isIos: true, isSafari: true }), true);
    assert.equal(isNativeHlsPlayback({ hlsCanPlayType: 'maybe', isIos: false, isSafari: true }), true);
    assert.equal(isNativeHlsPlayback({ hlsCanPlayType: '', isIos: false, isSafari: false }), false);
    assert.equal(resolveDecodeSupport({ nativeHls: false, mediaCapabilitiesSupported: true, canPlayType: '' }), true);
});

test('HEVC 非対応は canPlayType も MediaCapabilities も false なら候補にしない', () => {
    assert.equal(resolveDecodeSupport({ nativeHls: true, mediaCapabilitiesSupported: false, canPlayType: '' }), false);
    assert.equal(resolveDecodeSupport({ nativeHls: false, mediaCapabilitiesSupported: false, canPlayType: 'probably' }), false);
});
