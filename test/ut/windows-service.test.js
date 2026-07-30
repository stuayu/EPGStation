'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    SERVICE_DISPLAY_NAME,
    buildServiceEnvironment,
    buildServicePath,
    collectToolDirectories,
    defaultServiceAccountName,
    isNssmService,
    parseServiceAccount,
    toServiceId,
} = require('../../dist/util/WindowsService');

test('サービス名は winser 時代と同じ epgstation になる (net start epgstation を壊さない)', () => {
    assert.equal(toServiceId(SERVICE_DISPLAY_NAME), 'epgstation');
    assert.equal(toServiceId('EPG Station 2'), 'epgstation2');
});

test('config.yml から実行ファイルのディレクトリを集める', () => {
    const configText = [
        'port: 8888',
        "ffmpeg: 'C:\\ffmpeg\\bin\\ffmpeg.exe'",
        "ffprobe: 'C:\\ffmpeg\\bin\\ffprobe.exe'",
        'tsreadex: C:\\tools\\tsreadex.exe',
        'mirakurunPath: http://localhost:40772',
    ].join('\n');

    // 同じディレクトリは 1 度だけ、登場順で返す
    assert.deepEqual(collectToolDirectories(configText), ['C:\\ffmpeg\\bin', 'C:\\tools']);
});

test('PATH 上のコマンド名だけの指定は対象外', () => {
    assert.deepEqual(collectToolDirectories('ffmpeg: ffmpeg\nffprobe: ffprobe'), []);
});

test('行末コメントと引用符を落とす', () => {
    assert.deepEqual(collectToolDirectories("ffmpeg: 'C:\\ffmpeg\\bin\\ffmpeg.exe' # 実行ファイル"), [
        'C:\\ffmpeg\\bin',
    ]);
});

test('コメント行や別のキーは拾わない', () => {
    const configText = ['# ffmpeg: C:\\old\\ffmpeg.exe', 'recorded:', "    - path: 'C:\\recorded'"].join('\n');
    assert.deepEqual(collectToolDirectories(configText), []);
});

test('PATH はマシン全体の値を土台にして重複なく追加する', () => {
    const result = buildServicePath('C:\\Windows\\system32;C:\\Windows;C:\\Program Files\\nodejs\\', [
        'C:\\Program Files\\nodejs',
        'C:\\Program Files\\Git\\cmd',
        'C:\\ffmpeg\\bin',
    ]);

    // 末尾の区切り文字の違いは同じディレクトリとして扱う
    assert.equal(
        result,
        'C:\\Windows\\system32;C:\\Windows;C:\\Program Files\\nodejs;C:\\Program Files\\Git\\cmd;C:\\ffmpeg\\bin',
    );
});

test('空の要素は落とす', () => {
    assert.equal(buildServicePath('C:\\Windows;;', ['', '   ']), 'C:\\Windows');
});

test('サービスの環境変数には更新後の再起動方法を確定させる値を含める', () => {
    const entries = buildServiceEnvironment({
        machinePath: 'C:\\Windows',
        extraDirectories: ['C:\\Program Files\\Git\\cmd'],
        serviceName: 'epgstation',
    });

    assert.deepEqual(entries, [
        { name: 'Path', value: 'C:\\Windows;C:\\Program Files\\Git\\cmd' },
        { name: 'EPGSTATION_SERVICE_MANAGER', value: 'windows-service' },
        { name: 'EPGSTATION_WIN_SERVICE_NAME', value: 'epgstation' },
    ]);
});

test('実行アカウントの指定を domain と account に分ける', () => {
    // ドメイン省略・.\ 付き・ドメイン指定の 3 形式
    assert.deepEqual(parseServiceAccount('epgstation', 'MY-PC'), { domain: 'MY-PC', account: 'epgstation' });
    assert.deepEqual(parseServiceAccount('.\\epgstation', 'MY-PC'), { domain: 'MY-PC', account: 'epgstation' });
    assert.deepEqual(parseServiceAccount('MY-PC\\epgstation', 'OTHER'), { domain: 'MY-PC', account: 'epgstation' });
    assert.deepEqual(parseServiceAccount('corp.local\\epg', 'MY-PC'), { domain: 'corp.local', account: 'epg' });
    // 前後の空白は落とす
    assert.deepEqual(parseServiceAccount('  epgstation  ', 'MY-PC'), { domain: 'MY-PC', account: 'epgstation' });
});

test('アカウント名を判別できない指定は null にする', () => {
    assert.equal(parseServiceAccount('', 'MY-PC'), null);
    assert.equal(parseServiceAccount('   ', 'MY-PC'), null);
    // 区切り文字だけでアカウント名が無い
    assert.equal(parseServiceAccount('MY-PC\\', 'MY-PC'), null);
});

test('既定の実行アカウントはログオン中のユーザー (LocalSystem ではない)', () => {
    assert.equal(defaultServiceAccountName({ USERDOMAIN: 'MY-PC', USERNAME: 'epgstation' }), 'MY-PC\\epgstation');
    // USERDOMAIN が無ければ COMPUTERNAME を使う
    assert.equal(defaultServiceAccountName({ COMPUTERNAME: 'MY-PC', USERNAME: 'epgstation' }), 'MY-PC\\epgstation');
    // どちらも無ければユーザー名のみ
    assert.equal(defaultServiceAccountName({ USERNAME: 'epgstation' }), 'epgstation');
    // ユーザー名が取れない場合は空文字列 (呼び出し側で入力を求める)
    assert.equal(defaultServiceAccountName({}), '');
});

test('winser (nssm) 由来のサービスを sc.exe qc の出力から見分ける', () => {
    const nssm = 'BINARY_PATH_NAME   : C:\\Users\\epg\\AppData\\Roaming\\npm\\node_modules\\winser\\bin\\nssm.exe';
    const nodeWindows = 'BINARY_PATH_NAME   : C:\\EPGStation\\daemon\\epgstation.exe';

    assert.equal(isNssmService(nssm), true);
    assert.equal(isNssmService(nodeWindows), false);
    // 64bit 版の実行ファイル名も検出する
    assert.equal(isNssmService('BINARY_PATH_NAME : C:\\nssm\\nssm64.exe'), true);
});
