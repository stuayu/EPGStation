'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const ConfigApiModel = require('../../dist/model/api/config/ConfigApiModel').default;

/**
 * ConfigApiModel を組み立てる。
 * DI クラスなので依存はコンストラクタ引数の位置で渡す
 * (IConfiguration, IIPCClient, IStreamProfileManageModel)
 */
const createModel = config => {
    const configuration = {
        getConfig: () => config,
    };
    const ipc = {
        reserveation: {
            getBroadcastStatus: async () => ({}),
        },
    };
    const streamProfileManageModel = {
        getLiveProfiles: () => [],
        getRecordedProfiles: () => [],
    };

    return new ConfigApiModel(configuration, ipc, streamProfileManageModel);
};

const baseConfig = {
    port: 8888,
    recorded: [{ name: 'recorded', path: '/mnt/recorded' }],
    encode: [],
    urlscheme: {
        m2ts: {},
        video: {},
        download: {},
    },
};

test('http: socketioPort の指定が無ければ専用ポート扱いにしない', async () => {
    const result = await createModel(baseConfig).getConfig(false, 8888);

    assert.equal(result.socketIOPort, 8888);
    // Web API と同じ待ち受けを共有しているので、
    // クライアントはアクセス中のオリジンへそのまま接続してよい
    // (リバースプロキシでポートが変換されていても繋がる)
    assert.equal(result.useDedicatedSocketIOPort, false);
});

test('http: 直接アクセスで socketioPort を指定したら専用ポート扱いにする', async () => {
    const result = await createModel({ ...baseConfig, socketioPort: 8889 }).getConfig(false, 8888);

    assert.equal(result.socketIOPort, 8889);
    assert.equal(result.useDedicatedSocketIOPort, true);
});

test('https: socketioPort の指定が無ければ専用ポート扱いにしない', async () => {
    const result = await createModel({ ...baseConfig, https: { port: 8443 } }).getConfig(true, 8443);

    assert.equal(result.socketIOPort, 8443);
    assert.equal(result.useDedicatedSocketIOPort, false);
});

test('https: 直接アクセスで socketioPort を指定したら専用ポート扱いにする', async () => {
    const result = await createModel({ ...baseConfig, https: { port: 8443, socketioPort: 8444 } }).getConfig(true, 8443);

    assert.equal(result.socketIOPort, 8444);
    assert.equal(result.useDedicatedSocketIOPort, true);
});

test('clientSocketioPort の指定は直接アクセスなら専用ポート扱いにする', async () => {
    const result = await createModel({ ...baseConfig, clientSocketioPort: 8890 }).getConfig(false, 8888);

    assert.equal(result.socketIOPort, 8890);
    assert.equal(result.useDedicatedSocketIOPort, true);
});

test('リバースプロキシ経由なら専用ポートを指定していても勧めない', async () => {
    // 443 でアクセスされている = 自分の待ち受けポート (8888) ではない = プロキシ経由。
    // 専用ポートは外へ公開されていないのが普通なので、アクセス中のオリジンへ繋がせる
    const result = await createModel({ ...baseConfig, socketioPort: 8889 }).getConfig(true, 443);

    assert.equal(result.socketIOPort, 8889);
    assert.equal(result.useDedicatedSocketIOPort, false);
});

test('リバースプロキシ経由なら clientSocketioPort を指定していても勧めない', async () => {
    const result = await createModel({ ...baseConfig, clientSocketioPort: 8890 }).getConfig(false, 80);

    assert.equal(result.socketIOPort, 8890);
    assert.equal(result.useDedicatedSocketIOPort, false);
});

test('プロキシが TLS を終端している (https 設定が無い) 構成でも落ちない', async () => {
    // x-forwarded-proto: https で来るが EPGStation 自身は http でしか待ち受けていない。
    // 実際の待ち受けは http 側なので、そちらの設定で応答する
    const result = await createModel({ ...baseConfig, socketioPort: 8889 }).getConfig(true, 443);

    assert.equal(result.socketIOPort, 8889);
    assert.equal(result.useDedicatedSocketIOPort, false);
});

test('http の待ち受けが無ければ https 設定を使う', async () => {
    const config = { ...baseConfig, https: { port: 8443 } };
    delete config.port;
    const result = await createModel(config).getConfig(false, 8443);

    assert.equal(result.socketIOPort, 8443);
    assert.equal(result.useDedicatedSocketIOPort, false);
});

test('アクセス先のポートが判別できない場合は従来どおり専用ポートを勧める', async () => {
    const result = await createModel({ ...baseConfig, socketioPort: 8889 }).getConfig(false, null);

    assert.equal(result.socketIOPort, 8889);
    assert.equal(result.useDedicatedSocketIOPort, true);
});
