'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    CONFIG_OVERLAY_KEYS,
    configOverlayRequiresRestart,
    diffConfigOverlayKeys,
    mergeConfigOverlay,
    sanitizeConfigOverlay,
} = require('../../dist/model/config/ConfigOverlay');

const baseConfig = {
    port: 8888,
    mirakurunPath: 'http://localhost:40772',
    epgUpdateIntervalTime: 10,
    dbtype: 'sqlite',
    mysql: { host: 'localhost', user: 'epgstation', password: 'secret' },
    recorded: [{ name: 'recorded', path: '/mnt/recorded' }],
    featureFlags: { seriesLibrary: true, dashboard: true },
    updateChecker: { repository: 'stuayu/EPGStation', checkIntervalMs: 21600000 },
};

test('scalar values are overridden by the overlay', () => {
    const merged = mergeConfigOverlay(baseConfig, { port: 9999, epgUpdateIntervalTime: 5 });
    assert.equal(merged.port, 9999);
    assert.equal(merged.epgUpdateIntervalTime, 5);
    // 触っていないキーはそのまま
    assert.equal(merged.mirakurunPath, 'http://localhost:40772');
});

test('objects are merged key by key so untouched entries survive', () => {
    const merged = mergeConfigOverlay(baseConfig, { featureFlags: { dashboard: false } });
    assert.deepEqual(merged.featureFlags, { seriesLibrary: true, dashboard: false });
});

test('arrays are replaced wholesale (the list itself is what is edited)', () => {
    const merged = mergeConfigOverlay(baseConfig, {
        recorded: [{ name: 'new', path: '/mnt/new' }],
    });
    assert.deepEqual(merged.recorded, [{ name: 'new', path: '/mnt/new' }]);
});

test('the database connection can never be overridden from the GUI', () => {
    // オーバーレイ自体を DB から読むため、壊すと復旧できなくなる
    assert.equal(CONFIG_OVERLAY_KEYS.has('dbtype'), false);
    assert.equal(CONFIG_OVERLAY_KEYS.has('mysql'), false);
    assert.equal(CONFIG_OVERLAY_KEYS.has('sqlite'), false);
    assert.equal(CONFIG_OVERLAY_KEYS.has('postgres'), false);
    // 認証も画面へ入る手段そのものなので config.yml 専用にしている
    assert.equal(CONFIG_OVERLAY_KEYS.has('auth'), false);

    const merged = mergeConfigOverlay(baseConfig, { dbtype: 'mysql', mysql: { host: 'evil' } });
    assert.equal(merged.dbtype, 'sqlite');
    assert.equal(merged.mysql.host, 'localhost');
});

test('unknown and empty values are dropped from the overlay', () => {
    assert.deepEqual(sanitizeConfigOverlay({ unknownKey: 1, port: 8080 }), { port: 8080 });
    // null / undefined は「config.yml の値に戻す」の意味なので保存しない
    assert.deepEqual(sanitizeConfigOverlay({ port: null, mirakurunPath: undefined }), {});
    assert.deepEqual(sanitizeConfigOverlay(null), {});
    assert.deepEqual(sanitizeConfigOverlay([1, 2]), {});
});

test('nested null removes just that entry and falls back to the file value', () => {
    const merged = mergeConfigOverlay(baseConfig, { updateChecker: { checkIntervalMs: null, branch: 'develop' } });
    assert.equal(merged.updateChecker.branch, 'develop');
    assert.equal(merged.updateChecker.repository, 'stuayu/EPGStation');
    assert.equal('checkIntervalMs' in merged.updateChecker, false);
});

test('an empty overlay returns the file config untouched', () => {
    assert.equal(mergeConfigOverlay(baseConfig, {}), baseConfig);
    assert.equal(mergeConfigOverlay(baseConfig, undefined), baseConfig);
});

test('restart is only required for the keys that are read at startup', () => {
    assert.deepEqual(configOverlayRequiresRestart(['port', 'epgUpdateIntervalTime']), ['port']);
    assert.deepEqual(configOverlayRequiresRestart(['recorded', 'thumbnail', 'recordedFormat']), [
        'recorded',
        'thumbnail',
    ]);
    // 再起動不要な項目だけなら空
    assert.deepEqual(configOverlayRequiresRestart(['recordedFormat', 'ffmpeg']), []);
    assert.deepEqual(configOverlayRequiresRestart(null), []);
});

test('only the keys that actually differ from config.yml count as changed', () => {
    // 同じ値を送っても「変更あり」にはしない (無用な再起動案内を出さない)
    assert.deepEqual(diffConfigOverlayKeys(baseConfig, { port: 8888 }), []);
    assert.deepEqual(diffConfigOverlayKeys(baseConfig, { port: 9999 }), ['port']);
    assert.deepEqual(diffConfigOverlayKeys(baseConfig, { recorded: [{ name: 'recorded', path: '/mnt/recorded' }] }), []);
});

// --- 配信プロファイルと外部コマンド (追加でフォーム化した項目) ---

test('streaming profiles and external commands are editable from the GUI', () => {
    for (const key of [
        'stream',
        'reserveNewAddtionCommand',
        'recordingStartCommand',
        'recordingFinishCommand',
        'encodingFinishCommand',
    ]) {
        assert.equal(CONFIG_OVERLAY_KEYS.has(key), true, key);
    }
});

test('external commands require a restart but streaming profiles do not', () => {
    // ExternalCommandManageModel はコンストラクタで config を読む
    assert.deepEqual(configOverlayRequiresRestart(['recordingStartCommand']), ['recordingStartCommand']);
    // StreamProfileManageModel は呼び出しのたびに config を読む
    assert.deepEqual(configOverlayRequiresRestart(['stream']), []);
});

test('a streaming profile overlay merges per scope and keeps the other scopes', () => {
    const base = {
        ...baseConfig,
        stream: {
            live: { ts: { mp4: [{ name: '1080p', cmd: 'a' }], webm: [{ name: 'webm', cmd: 'b' }] } },
            recorded: { ts: { mp4: [{ name: 'rec', cmd: 'c' }] } },
        },
    };
    const merged = mergeConfigOverlay(base, {
        stream: { live: { ts: { mp4: [{ name: '720p', cmd: 'z' }] } } },
    });
    // 差し替えたコンテナだけが変わる
    assert.deepEqual(merged.stream.live.ts.mp4, [{ name: '720p', cmd: 'z' }]);
    assert.deepEqual(merged.stream.live.ts.webm, [{ name: 'webm', cmd: 'b' }]);
    assert.deepEqual(merged.stream.recorded.ts.mp4, [{ name: 'rec', cmd: 'c' }]);
});
