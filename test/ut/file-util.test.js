'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');
const FileUtil = require('../../dist/util/FileUtil').default;

// 実 fs (一時ディレクトリ) を使った FileUtil のラウンドトリップ検証。
// FileUtil は fs のコールバック API を Promise 化するだけの薄いラッパーなので、
// モックせず実際のファイル操作で成功 / 失敗の両方を確認する

const makeTmpDir = async prefix => fsp.mkdtemp(path.join(os.tmpdir(), prefix));

test('writeFile() / readFile() はラウンドトリップできる', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        const file = path.join(dir, 'a.txt');
        await FileUtil.writeFile(file, 'hello world');
        const data = await FileUtil.readFile(file);
        assert.equal(data, 'hello world');
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('access() は存在するファイルなら解決し、存在しなければ拒否する', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        const file = path.join(dir, 'a.txt');
        await fsp.writeFile(file, 'x');
        await assert.doesNotReject(() => FileUtil.access(file, undefined));
        await assert.rejects(() => FileUtil.access(path.join(dir, 'no-such-file.txt'), undefined));
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('unlink() はファイルを削除し、二重に消そうとすると拒否する', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        const file = path.join(dir, 'a.txt');
        await fsp.writeFile(file, 'x');
        await FileUtil.unlink(file);
        await assert.rejects(() => fsp.access(file));
        await assert.rejects(() => FileUtil.unlink(file));
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('mkdir() はネストしたディレクトリを一括で作成する (mkdirp)', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        const nested = path.join(dir, 'a', 'b', 'c');
        await FileUtil.mkdir(nested);
        const stat = await fsp.stat(nested);
        assert.equal(stat.isDirectory(), true);
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('stat() / getFileSize() はファイルサイズを返し、存在しないファイルは FileIsNotFound を投げる', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        const file = path.join(dir, 'a.txt');
        await fsp.writeFile(file, '0123456789');
        const stat = await FileUtil.stat(file);
        assert.equal(stat.size, 10);
        const size = await FileUtil.getFileSize(file);
        assert.equal(size, 10);

        await assert.rejects(() => FileUtil.getFileSize(path.join(dir, 'missing.txt')), /FileIsNotFound/);
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('readDir() はディレクトリ直下のエントリ名一覧を返す', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        await fsp.writeFile(path.join(dir, 'a.txt'), '');
        await fsp.writeFile(path.join(dir, 'b.txt'), '');
        const entries = await FileUtil.readDir(dir);
        assert.deepEqual(entries.sort(), ['a.txt', 'b.txt']);
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('readDir() は存在しないディレクトリを拒否する', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        await assert.rejects(() => FileUtil.readDir(path.join(dir, 'no-such-dir')));
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('writeFile() は書き込み先のディレクトリが存在しなければ拒否する', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        await assert.rejects(() => FileUtil.writeFile(path.join(dir, 'no-such-dir', 'a.txt'), 'x'));
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('touchFile() は書き込み先のディレクトリが存在しなければ拒否する', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        await assert.rejects(() => FileUtil.touchFile(path.join(dir, 'no-such-dir', 'a.txt')));
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('appendFile() は書き込み先のディレクトリが存在しなければ拒否する', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        await assert.rejects(() => FileUtil.appendFile(path.join(dir, 'no-such-dir', 'a.txt'), 'x'));
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('getFileList() は存在しないディレクトリを拒否する', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        await assert.rejects(() => FileUtil.getFileList(path.join(dir, 'no-such-dir')));
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('isEmptyDirectory() は存在しないディレクトリを拒否する', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        await assert.rejects(() => FileUtil.isEmptyDirectory(path.join(dir, 'no-such-dir')));
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('rename() はファイルを移動する', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        const src = path.join(dir, 'src.txt');
        const dest = path.join(dir, 'dest.txt');
        await fsp.writeFile(src, 'content');
        await FileUtil.rename(src, dest);
        assert.equal(await fsp.readFile(dest, 'utf-8'), 'content');
        await assert.rejects(() => fsp.access(src));
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('rename() は失敗すると dest 側の中途半端なファイルを消してから reject する', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        // src が存在しないので rename は必ず失敗する。dest 側の unlink（存在しないので失敗）も
        // catch で握り潰され、rename 自体のエラーが reject されることを確認する
        await assert.rejects(() =>
            FileUtil.rename(path.join(dir, 'no-such-src.txt'), path.join(dir, 'no-such-dest.txt')),
        );
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('copyFile() はコピー元の内容を保ったままコピー先を作る', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        const src = path.join(dir, 'src.txt');
        const dest = path.join(dir, 'dest.txt');
        await fsp.writeFile(src, 'copy-me');
        await FileUtil.copyFile(src, dest);
        assert.equal(await fsp.readFile(dest, 'utf-8'), 'copy-me');
        // コピー元は残る (move() との違い)
        assert.equal(await fsp.readFile(src, 'utf-8'), 'copy-me');
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('move() はコピーしてからコピー元を削除する', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        const src = path.join(dir, 'src.txt');
        const dest = path.join(dir, 'dest.txt');
        await fsp.writeFile(src, 'move-me');
        await FileUtil.move(src, dest);
        assert.equal(await fsp.readFile(dest, 'utf-8'), 'move-me');
        await assert.rejects(() => fsp.access(src));
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('move() はコピーに失敗すると例外を投げ、dest 側の中途半端なファイルを残さない', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        const src = path.join(dir, 'no-such-src.txt');
        const dest = path.join(dir, 'dest.txt');
        await assert.rejects(() => FileUtil.move(src, dest));
        await assert.rejects(() => fsp.access(dest));
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('touchFile() は空ファイルを作成する', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        const file = path.join(dir, 'touched.txt');
        await FileUtil.touchFile(file);
        assert.equal(await fsp.readFile(file, 'utf-8'), '');
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('appendFile() は既存の内容の末尾に追記する', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        const file = path.join(dir, 'log.txt');
        await fsp.writeFile(file, 'first\n');
        await FileUtil.appendFile(file, 'second\n');
        assert.equal(await fsp.readFile(file, 'utf-8'), 'first\nsecond\n');
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('getFileList() は隠しディレクトリを除いてサブディレクトリを再帰的に辿る', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        await fsp.writeFile(path.join(dir, 'root.txt'), '');
        await fsp.mkdir(path.join(dir, 'sub'));
        await fsp.writeFile(path.join(dir, 'sub', 'child.txt'), '');
        await fsp.mkdir(path.join(dir, '.hidden'));
        await fsp.writeFile(path.join(dir, '.hidden', 'ignored.txt'), '');

        const result = await FileUtil.getFileList(dir);
        const relFiles = result.files.map(f => path.relative(dir, f)).sort();
        const relDirs = result.directories.map(f => path.relative(dir, f)).sort();

        assert.deepEqual(relFiles, ['root.txt', path.join('sub', 'child.txt')]);
        assert.deepEqual(relDirs, ['sub']);
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('isEmptyDirectory() は空ディレクトリで true、ファイルがあれば false を返す', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        assert.equal(await FileUtil.isEmptyDirectory(dir), true);
        await fsp.writeFile(path.join(dir, 'a.txt'), '');
        assert.equal(await FileUtil.isEmptyDirectory(dir), false);
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});

test('rmdir() は空ディレクトリを削除し、中身が残っていると拒否する', async () => {
    const dir = await makeTmpDir('epgstation-fileutil-');
    try {
        const emptyDir = path.join(dir, 'empty');
        await fsp.mkdir(emptyDir);
        await FileUtil.rmdir(emptyDir);
        await assert.rejects(() => fsp.access(emptyDir));

        const nonEmptyDir = path.join(dir, 'not-empty');
        await fsp.mkdir(nonEmptyDir);
        await fsp.writeFile(path.join(nonEmptyDir, 'a.txt'), '');
        await assert.rejects(() => FileUtil.rmdir(nonEmptyDir));
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});
