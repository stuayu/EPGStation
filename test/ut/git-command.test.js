'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
    buildGitArgs,
    findGitExecutable,
    resolveNpmCommand,
    toGitPath,
} = require('../../dist/util/GitCommand');

const input = (override = {}) => ({
    platform: 'win32',
    env: {},
    isInPath: false,
    exists: () => false,
    ...override,
});

test('PATH 上に git があればそのまま git を使う', () => {
    assert.equal(findGitExecutable(input({ isInPath: true })), 'git');
    assert.equal(findGitExecutable(input({ platform: 'linux', isInPath: true })), 'git');
});

test('Windows 以外では既知のインストール先を探さない', () => {
    let called = false;
    const result = findGitExecutable(
        input({
            platform: 'linux',
            exists: () => {
                called = true;
                return true;
            },
        }),
    );
    assert.equal(result, 'git');
    assert.equal(called, false);
});

test('Windows サービスの PATH に git が無い場合は既定のインストール先から探す', () => {
    const found = 'C:\\Program Files\\Git\\cmd\\git.exe';
    const result = findGitExecutable(
        input({
            env: { ProgramFiles: 'C:\\Program Files' },
            exists: filePath => filePath === found,
        }),
    );
    assert.equal(result, found);
});

test('環境変数が未定義の候補は飛ばす', () => {
    // %LOCALAPPDATA% だけ定義されている状態で、その候補が選ばれる
    const found = 'C:\\Users\\epg\\AppData\\Local\\Programs\\Git\\cmd\\git.exe';
    const result = findGitExecutable(
        input({
            env: { LOCALAPPDATA: 'C:\\Users\\epg\\AppData\\Local' },
            exists: filePath => filePath === found,
        }),
    );
    assert.equal(result, found);
});

test('どこにも見つからない場合は git を返す (呼び出し側で ENOENT になる)', () => {
    assert.equal(findGitExecutable(input({ env: { ProgramFiles: 'C:\\Program Files' } })), 'git');
});

test('git に渡すパスは / 区切りへ変換する', () => {
    assert.equal(toGitPath('C:\\EPGStation'), 'C:/EPGStation');
    assert.equal(toGitPath('/opt/EPGStation'), '/opt/EPGStation');
});

test('safe.directory を毎回渡してリポジトリの所有者チェックを回避する', () => {
    assert.deepEqual(buildGitArgs('C:\\EPGStation', ['status', '--porcelain']), [
        '-c',
        'safe.directory=C:/EPGStation',
        'status',
        '--porcelain',
    ]);
    // 引数の順序は変えない (git のサブコマンドより前に -c が必要)
    assert.deepEqual(buildGitArgs('/opt/EPGStation', ['fetch']), ['-c', 'safe.directory=/opt/EPGStation', 'fetch']);
});

test('Windows の npm はシェル経由で起動する', () => {
    assert.deepEqual(resolveNpmCommand('win32'), { command: 'npm.cmd', shell: true });
    assert.deepEqual(resolveNpmCommand('linux'), { command: 'npm', shell: false });
});
