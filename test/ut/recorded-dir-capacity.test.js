'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    DEFAULT_STORAGE_FALLBACK_CONFIG,
    estimateRecordingBytes,
    resolveStorageFallbackConfig,
    selectRecordedDir,
} = require('../../dist/model/operator/recording/RecordedDirCapacity');

const GB = 1024 * 1024 * 1024;
const dir = name => ({ name, path: `X:\\${name}` });

// 余裕を 0 にして「番組本体の見積もり」だけを見るための設定
const noMargin = extra =>
    Object.assign({}, DEFAULT_STORAGE_FALLBACK_CONFIG, { marginBytes: 0, bitrate: { ...DEFAULT_STORAGE_FALLBACK_CONFIG.bitrate } }, extra);

test('番組長とビットレートから録画サイズを見積もる', () => {
    // 30 分 × 19Mbps / 8 = 4275MB
    const bytes = estimateRecordingBytes(30 * 60 * 1000, 'GR', noMargin());
    assert.equal(bytes, Math.round((30 * 60 * 19_000_000) / 8));
});

test('放送種別ごとに既定ビットレートを使い分ける', () => {
    const gr = estimateRecordingBytes(60 * 60 * 1000, 'GR', noMargin());
    const bs = estimateRecordingBytes(60 * 60 * 1000, 'BS', noMargin());
    const bs4k = estimateRecordingBytes(60 * 60 * 1000, 'BS4K', noMargin());
    assert.ok(bs > gr, 'BS は GR より大きい');
    assert.ok(bs4k > bs, 'BS4K は BS より大きい');
});

test('表に無い放送種別 (県外地上波 NW*) は既定ビットレートで見積もる', () => {
    const nw = estimateRecordingBytes(30 * 60 * 1000, 'NW7', noMargin());
    assert.equal(nw, Math.round((30 * 60 * 19_000_000) / 8));
});

test('余裕 (marginBytes) が見積もりに加算される', () => {
    const c = Object.assign({}, DEFAULT_STORAGE_FALLBACK_CONFIG, { marginBytes: 2 * GB });
    const bytes = estimateRecordingBytes(30 * 60 * 1000, 'GR', c);
    assert.equal(bytes, Math.round((30 * 60 * 19_000_000) / 8) + 2 * GB);
});

test('番組長が負や 0 でも負のサイズにならない', () => {
    assert.equal(estimateRecordingBytes(-1000, 'GR', noMargin()), 0);
    assert.equal(estimateRecordingBytes(0, 'GR', noMargin()), 0);
});

test('第一候補に空きがあればそのまま使う', () => {
    const r = selectRecordedDir(
        [
            { dir: dir('TS'), freeBytes: 100 * GB },
            { dir: dir('TS1'), freeBytes: 500 * GB },
        ],
        10 * GB,
    );
    assert.equal(r.reason, 'primary');
    assert.equal(r.dir.name, 'TS');
});

test('第一候補が足りなければ次の候補へ振り替える', () => {
    const r = selectRecordedDir(
        [
            { dir: dir('TS'), freeBytes: 1 * GB },
            { dir: dir('TS1'), freeBytes: 50 * GB },
        ],
        10 * GB,
    );
    assert.equal(r.reason, 'fallback');
    assert.equal(r.dir.name, 'TS1');
});

test('満杯になり次第、順次さらに次の候補へ送る', () => {
    const candidates = [
        { dir: dir('TS'), freeBytes: 0 },
        { dir: dir('TS1'), freeBytes: 1 * GB },
        { dir: dir('TS2'), freeBytes: 7000 * GB },
    ];
    const r = selectRecordedDir(candidates, 10 * GB);
    assert.equal(r.reason, 'fallback');
    assert.equal(r.dir.name, 'TS2');
});

test('どこも足りない場合は最も空きが大きい候補を使い insufficient を返す', () => {
    const r = selectRecordedDir(
        [
            { dir: dir('TS'), freeBytes: 1 * GB },
            { dir: dir('TS1'), freeBytes: 5 * GB },
            { dir: dir('TS2'), freeBytes: 3 * GB },
        ],
        100 * GB,
    );
    assert.equal(r.reason, 'insufficient');
    assert.equal(r.dir.name, 'TS1');
});

test('空き容量を 1 つも取得できない場合は第一候補のまま進める', () => {
    const r = selectRecordedDir(
        [
            { dir: dir('TS'), freeBytes: null },
            { dir: dir('TS1'), freeBytes: null },
        ],
        10 * GB,
    );
    assert.equal(r.reason, 'unknown');
    assert.equal(r.dir.name, 'TS');
    assert.equal(r.freeBytes, null);
});

test('空き容量を取得できなかった候補は飛ばして次を見る', () => {
    const r = selectRecordedDir(
        [
            { dir: dir('TS'), freeBytes: null },
            { dir: dir('TS1'), freeBytes: 50 * GB },
        ],
        10 * GB,
    );
    assert.equal(r.reason, 'fallback');
    assert.equal(r.dir.name, 'TS1');
});

test('候補が空なら null', () => {
    assert.equal(selectRecordedDir([], 1), null);
});

test('設定は未指定・範囲外なら既定へ丸める', () => {
    const d = resolveStorageFallbackConfig(undefined);
    assert.equal(d.enabled, true);
    assert.equal(d.marginBytes, DEFAULT_STORAGE_FALLBACK_CONFIG.marginBytes);
    assert.equal(d.overrideBitrate, null);

    const off = resolveStorageFallbackConfig({ storageFallbackEnabled: false });
    assert.equal(off.enabled, false);

    // 0 以下・非数のビットレートは上書きせず放送種別ごとの既定を使う
    for (const bad of [0, -5, 'x', null]) {
        assert.equal(resolveStorageFallbackConfig({ storageFallbackBitrateMbps: bad }).overrideBitrate, null);
    }

    const over = resolveStorageFallbackConfig({ storageFallbackBitrateMbps: 24 });
    assert.equal(over.overrideBitrate, 24_000_000);

    const margin = resolveStorageFallbackConfig({ storageFallbackMarginMB: 512 });
    assert.equal(margin.marginBytes, 512 * 1024 * 1024);
});

test('ビットレートを上書きすると放送種別によらずその値を使う', () => {
    const c = resolveStorageFallbackConfig({ storageFallbackBitrateMbps: 8, storageFallbackMarginMB: 0 });
    const gr = estimateRecordingBytes(60 * 60 * 1000, 'GR', c);
    const bs = estimateRecordingBytes(60 * 60 * 1000, 'BS', c);
    assert.equal(gr, bs);
    assert.equal(gr, Math.round((60 * 60 * 8_000_000) / 8));
});
