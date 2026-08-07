'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
require('reflect-metadata');

const AppSettingApiModel = require('../../dist/model/api/config/AppSettingApiModel').default;

// AppSettingApiModel は DI コンストラクタ経由でしか作れないが、対象メソッドは
// (private 修飾でも実行時には効かない) 依存を使わない純粋な変換ロジックなので、
// コンストラクタを経由せずプロトタイプだけを借りたインスタンスで直接叩く。
function createInstance() {
    return Object.create(AppSettingApiModel.prototype);
}

const PLACEHOLDER = AppSettingApiModel.CONFIG_SECRET_PLACEHOLDER;

// -----------------------------------------------------------------------------
// 1. maskConfig() / maskConfigValue() / isConfigSecretPath() — 秘密情報マスク
//
// これが壊れると config.yml に書かれた認証情報 (DB パスワード・OAuth シークレット・
// LLM の API キー等) がそのまま Web UI (設定画面) へ露出する。もっとも事故の影響が
// 大きい箇所なので、マスクされる/されないの両方を具体的な path で固定する。
// -----------------------------------------------------------------------------

test('maskConfig: ConfigSchema の secret:true (seriesLlm.apiKey) がマスクされる', () => {
    const m = createInstance();
    const masked = m.maskConfig({ seriesLlm: { url: 'http://localhost:1234', apiKey: 'sk-xxxxxxxx' } });
    assert.equal(masked.seriesLlm.apiKey, PLACEHOLDER);
    // 隣の非秘密項目はマスクされない
    assert.equal(masked.seriesLlm.url, 'http://localhost:1234');
});

test('maskConfig: auth.clientSecret / auth.google.clientSecret がネストしていてもマスクされる', () => {
    const m = createInstance();
    const masked = m.maskConfig({
        auth: {
            clientId: 'my-client-id',
            clientSecret: 'top-secret',
            google: { clientId: 'g-id', clientSecret: 'g-secret' },
        },
    });
    assert.equal(masked.auth.clientSecret, PLACEHOLDER);
    assert.equal(masked.auth.google.clientSecret, PLACEHOLDER);
    // clientId はマスク対象外
    assert.equal(masked.auth.clientId, 'my-client-id');
    assert.equal(masked.auth.google.clientId, 'g-id');
});

test('maskConfig: mysql.password / postgres.password がマスクされる', () => {
    const m = createInstance();
    const masked = m.maskConfig({
        mysql: { host: 'localhost', password: 'my-mysql-pass' },
        postgres: { host: 'localhost', password: 'my-postgres-pass' },
    });
    assert.equal(masked.mysql.password, PLACEHOLDER);
    assert.equal(masked.postgres.password, PLACEHOLDER);
    assert.equal(masked.mysql.host, 'localhost');
});

test('maskConfig: notifications.targets[] の url は配列の全要素でマスクされる (Webhook URL 漏洩防止)', () => {
    const m = createInstance();
    const masked = m.maskConfig({
        notifications: {
            targets: [
                { name: 'discord', url: 'https://discord.com/api/webhooks/xxx', token: 'tk1' },
                { name: 'slack', url: 'https://hooks.slack.com/services/yyy' },
            ],
        },
    });
    assert.equal(masked.notifications.targets[0].url, PLACEHOLDER);
    assert.equal(masked.notifications.targets[0].token, PLACEHOLDER);
    assert.equal(masked.notifications.targets[1].url, PLACEHOLDER);
    // name はマスク対象外
    assert.equal(masked.notifications.targets[0].name, 'discord');
    assert.equal(masked.notifications.targets[1].name, 'slack');
});

test('maskConfig: どこにあっても token / apiKey / secret / password という名前のキーはマスクされる', () => {
    const m = createInstance();
    const masked = m.maskConfig({
        someFeature: {
            nested: {
                deeply: {
                    token: 'a-token',
                    apiKey: 'an-api-key',
                    secret: 'a-secret',
                    password: 'a-password',
                },
            },
        },
    });
    const leaf = masked.someFeature.nested.deeply;
    assert.equal(leaf.token, PLACEHOLDER);
    assert.equal(leaf.apiKey, PLACEHOLDER);
    assert.equal(leaf.secret, PLACEHOLDER);
    assert.equal(leaf.password, PLACEHOLDER);
});

test('maskConfig: auth.clientId はマスクされない', () => {
    const m = createInstance();
    const masked = m.maskConfig({ auth: { clientId: 'plain-client-id' } });
    assert.equal(masked.auth.clientId, 'plain-client-id');
});

test('maskConfig: seriesLlm.url はマスクされない (secret ではない項目)', () => {
    const m = createInstance();
    const masked = m.maskConfig({ seriesLlm: { url: 'http://localhost:11434' } });
    assert.equal(masked.seriesLlm.url, 'http://localhost:11434');
});

test('maskConfig: 数値 (port) はマスク判定の対象外でそのまま通る', () => {
    const m = createInstance();
    const masked = m.maskConfig({ port: 8888 });
    assert.equal(masked.port, 8888);
});

test('maskConfig: recorded[].path のような非秘密な配列項目はマスクされない', () => {
    const m = createInstance();
    const masked = m.maskConfig({ recorded: [{ name: 'recorded', path: '/mnt/recorded' }] });
    assert.deepEqual(masked.recorded, [{ name: 'recorded', path: '/mnt/recorded' }]);
});

test('maskConfig: 空文字はマスク対象キーでもそのまま (伏せ字にしない)', () => {
    const m = createInstance();
    const masked = m.maskConfig({ auth: { clientSecret: '' } });
    assert.equal(masked.auth.clientSecret, '');
});

test('maskConfig: 伏せ字は AppSettingApiModel.CONFIG_SECRET_PLACEHOLDER (\'********\') と一致する', () => {
    assert.equal(PLACEHOLDER, '********');
});

test('maskConfig: ConfigSchema の secret:true フラグが実際にマスクを駆動している (キー名ベースの汎用判定とは独立に効く)', () => {
    // CONFIG_SCHEMA_SECRET_PATHS は AppSettingApiModel モジュール読み込み時に一度だけ
    // CONFIG_SCHEMA から構築される。既存の secret:true エントリ (seriesLlm.apiKey) は
    // キー名が汎用マスク対象 (apiKey) と重なるため、そのテストだけでは
    // 「ConfigSchema の secret フラグ自体が使われているか」を切り分けられない。
    // そこで、汎用キー名一覧 (token/apiKey/secret/password/clientSecret) に
    // 含まれない独自パスを ConfigSchema に secret:true で追加してから
    // AppSettingApiModel を読み直し、そのパスがマスクされることで
    // ConfigSchema 側のフラグが実際に駆動源として使われていることを確認する。
    const schemaModulePath = require.resolve('../../dist/model/config/ConfigSchema');
    const appSettingModulePath = require.resolve('../../dist/model/api/config/AppSettingApiModel');
    const { CONFIG_SCHEMA } = require(schemaModulePath);

    const fakeEntry = {
        key: 'seriesLlm',
        label: 'fake for test',
        editable: 'gui',
        requiresRestart: false,
        fields: [
            {
                path: 'seriesLlm.customSecretMarkerForTest',
                label: 'fake secret field',
                type: 'string',
                secret: true,
            },
        ],
    };
    CONFIG_SCHEMA.push(fakeEntry);
    delete require.cache[appSettingModulePath];
    try {
        const ReloadedModel = require(appSettingModulePath).default;
        const m = Object.create(ReloadedModel.prototype);
        const masked = m.maskConfig({ seriesLlm: { customSecretMarkerForTest: 'plain-value-not-generic-key' } });
        assert.equal(
            masked.seriesLlm.customSecretMarkerForTest,
            ReloadedModel.CONFIG_SECRET_PLACEHOLDER,
            'ConfigSchema の secret:true を追加した独自パスがマスクされていない (ConfigSchema がマスクの駆動に使われていない疑い)',
        );
    } finally {
        CONFIG_SCHEMA.pop();
        delete require.cache[appSettingModulePath];
    }
});

// -----------------------------------------------------------------------------
// 2. stripMaskedPlaceholders() — 伏せ字のまま送り返された leaf の再帰的な削除
//
// これが効かないと、画面を一度も編集していないシークレット入力欄がそのまま
// '********' として PUT され、既存の API キー等が伏せ字の文字列そのもので
// 上書きされてしまう (実質的なシークレット喪失事故)。
// -----------------------------------------------------------------------------

test('stripMaskedPlaceholders: 伏せ字のトップレベル leaf が削除される', () => {
    const result = AppSettingApiModel.stripMaskedPlaceholders({
        seriesLlm: { apiKey: PLACEHOLDER, url: 'http://localhost' },
    });
    assert.deepEqual(result, { seriesLlm: { url: 'http://localhost' } });
});

test('stripMaskedPlaceholders: ネストした leaf も再帰的に削除される', () => {
    const result = AppSettingApiModel.stripMaskedPlaceholders({
        auth: { clientId: 'cid', google: { clientId: 'gid', clientSecret: PLACEHOLDER } },
    });
    assert.deepEqual(result, { auth: { clientId: 'cid', google: { clientId: 'gid' } } });
});

test('stripMaskedPlaceholders: 配列内の伏せ字 leaf も削除される', () => {
    const result = AppSettingApiModel.stripMaskedPlaceholders({
        notifications: {
            targets: [
                { name: 'a', url: PLACEHOLDER, token: 'kept-real-token' },
                { name: 'b', url: 'http://real-url' },
            ],
        },
    });
    assert.deepEqual(result, {
        notifications: {
            targets: [{ name: 'a', token: 'kept-real-token' }, { name: 'b', url: 'http://real-url' }],
        },
    });
});

test('stripMaskedPlaceholders: 伏せ字でない値は残る', () => {
    const result = AppSettingApiModel.stripMaskedPlaceholders({
        port: 8888,
        recorded: [{ name: 'recorded', path: '/mnt/recorded' }],
        emptyString: '',
    });
    assert.deepEqual(result, {
        port: 8888,
        recorded: [{ name: 'recorded', path: '/mnt/recorded' }],
        emptyString: '',
    });
});

// -----------------------------------------------------------------------------
// 3. pruneLeavesEqualToFileConfig() — config.yml と同値になった overlay leaf の除去
// -----------------------------------------------------------------------------

test('pruneLeavesEqualToFileConfig: config.yml と同じ値のスカラー leaf は落ちる', () => {
    const result = AppSettingApiModel.pruneLeavesEqualToFileConfig({ port: 8888 }, { port: 8888 });
    assert.deepEqual(result, {});
});

test('pruneLeavesEqualToFileConfig: config.yml と違う値のスカラー leaf は残る', () => {
    const result = AppSettingApiModel.pruneLeavesEqualToFileConfig({ port: 9999 }, { port: 8888 });
    assert.deepEqual(result, { port: 9999 });
});

test('pruneLeavesEqualToFileConfig: ネストしたオブジェクトは leaf 単位で判定される (recording.errorRetryCount)', () => {
    const fileConfig = { recording: { errorRetryCount: 27, errorRetryIntervalMs: 60000 } };
    const overlay = { recording: { errorRetryCount: 27, errorRetryIntervalMs: 5000 } };
    const result = AppSettingApiModel.pruneLeavesEqualToFileConfig(overlay, fileConfig);
    // 同値の errorRetryCount は落ち、違う errorRetryIntervalMs だけ残る
    assert.deepEqual(result, { recording: { errorRetryIntervalMs: 5000 } });
});

test('pruneLeavesEqualToFileConfig: 配列は leaf 分解せず、config.yml と完全一致なら丸ごと落ちる', () => {
    const fileConfig = { recorded: [{ name: 'recorded', path: '/mnt/recorded' }] };
    const overlay = { recorded: [{ name: 'recorded', path: '/mnt/recorded' }] };
    const result = AppSettingApiModel.pruneLeavesEqualToFileConfig(overlay, fileConfig);
    assert.deepEqual(result, {});
});

test('pruneLeavesEqualToFileConfig: 配列は 1 要素でも違えば配列全体が残る', () => {
    const fileConfig = { recorded: [{ name: 'recorded', path: '/mnt/recorded' }] };
    const overlay = { recorded: [{ name: 'recorded', path: '/mnt/recorded-changed' }] };
    const result = AppSettingApiModel.pruneLeavesEqualToFileConfig(overlay, fileConfig);
    assert.deepEqual(result, { recorded: [{ name: 'recorded', path: '/mnt/recorded-changed' }] });
});

test('pruneLeavesEqualToFileConfig: 全 leaf が同値なら結果は空オブジェクトになる', () => {
    const fileConfig = {
        port: 8888,
        recording: { errorRetryCount: 27, errorRetryIntervalMs: 60000 },
        recorded: [{ name: 'recorded', path: '/mnt/recorded' }],
    };
    const overlay = {
        port: 8888,
        recording: { errorRetryCount: 27, errorRetryIntervalMs: 60000 },
        recorded: [{ name: 'recorded', path: '/mnt/recorded' }],
    };
    const result = AppSettingApiModel.pruneLeavesEqualToFileConfig(overlay, fileConfig);
    assert.deepEqual(result, {});
});

// -----------------------------------------------------------------------------
// 4. buildProvenance() — 出所判定 (default / file / overlay)
// -----------------------------------------------------------------------------

test('buildProvenance: overlay にある path は overlay と判定される (トップレベル)', () => {
    const m = createInstance();
    const provenance = m.buildProvenance({ port: 9999 }, {});
    assert.equal(provenance.port, 'overlay');
});

test('buildProvenance: overlay に無く生の config.yml にある path は file と判定される (トップレベル)', () => {
    const m = createInstance();
    const provenance = m.buildProvenance({}, { epgUpdateIntervalTime: 20 });
    assert.equal(provenance.epgUpdateIntervalTime, 'file');
});

test('buildProvenance: overlay にも生の config.yml にも無い path は default と判定される (トップレベル)', () => {
    const m = createInstance();
    const provenance = m.buildProvenance({}, {});
    assert.equal(provenance.mirakurunPath, 'default');
});

test('buildProvenance: ネストした fields[].path (recording.errorRetryCount) でも overlay/file/default を判定できる', () => {
    const m = createInstance();

    const provenanceOverlay = m.buildProvenance({ recording: { errorRetryCount: 5 } }, {});
    assert.equal(provenanceOverlay['recording.errorRetryCount'], 'overlay');

    const provenanceFile = m.buildProvenance({}, { recording: { errorRetryCount: 5 } });
    assert.equal(provenanceFile['recording.errorRetryCount'], 'file');

    const provenanceDefault = m.buildProvenance({}, {});
    assert.equal(provenanceDefault['recording.errorRetryCount'], 'default');
});

test('buildProvenance: overlay が優先される (overlay と file の両方に値がある場合)', () => {
    const m = createInstance();
    const provenance = m.buildProvenance({ port: 9999 }, { port: 8888 });
    assert.equal(provenance.port, 'overlay');
});
