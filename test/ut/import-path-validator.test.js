'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ImportPathValidator = require('../../dist/model/recorded/import/ImportPathValidator').default;

const mkTmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'epgs18-path-'));

test('validateSubDirectory accepts normal relative paths', () => {
    assert.doesNotThrow(() => ImportPathValidator.validateSubDirectory(''));
    assert.doesNotThrow(() => ImportPathValidator.validateSubDirectory('anime'));
    assert.doesNotThrow(() => ImportPathValidator.validateSubDirectory('anime/2026'));
});

test('validateSubDirectory rejects traversal and absolute paths', () => {
    assert.throws(() => ImportPathValidator.validateSubDirectory('../etc'), /InvalidSubDirectory/);
    assert.throws(() => ImportPathValidator.validateSubDirectory('a/../../b'), /InvalidSubDirectory/);
    assert.throws(() => ImportPathValidator.validateSubDirectory('/etc/passwd'), /InvalidSubDirectory/);
    assert.throws(() => ImportPathValidator.validateSubDirectory('C:\\Windows'), /InvalidSubDirectory/);
    assert.throws(() => ImportPathValidator.validateSubDirectory('\\\\host\\share'), /InvalidSubDirectory/);
});

test('resolveImportTargetPath throws when importDirs is empty', async () => {
    await assert.rejects(() => ImportPathValidator.resolveImportTargetPath('/tmp/x', []), /ImportDirsNotConfigured/);
});

test('resolveImportTargetPath accepts a file within an importDir', async () => {
    const dir = mkTmpDir();
    const file = path.join(dir, 'sample.ts');
    fs.writeFileSync(file, 'x');

    const resolved = await ImportPathValidator.resolveImportTargetPath(file, [{ name: 'edcb', path: dir }]);
    assert.equal(resolved.dirName, 'edcb');
    assert.equal(resolved.relativePath, 'sample.ts');
});

test('resolveImportTargetPath rejects a file outside importDirs', async () => {
    const dir = mkTmpDir();
    const outside = mkTmpDir();
    const file = path.join(outside, 'secret.ts');
    fs.writeFileSync(file, 'x');

    await assert.rejects(
        () => ImportPathValidator.resolveImportTargetPath(file, [{ name: 'edcb', path: dir }]),
        /ImportPathNotAllowed/,
    );
});

test('resolveImportTargetPath rejects escape via a symlinked directory outside importDirs', async () => {
    const importRoot = mkTmpDir();
    const secretRoot = mkTmpDir();
    const secretFile = path.join(secretRoot, 'secret.ts');
    fs.writeFileSync(secretFile, 'x');

    const linkPath = path.join(importRoot, 'escape-link');
    try {
        fs.symlinkSync(secretRoot, linkPath, 'dir');
    } catch (err) {
        // シンボリックリンク作成に権限が必要な環境 (Windows 等) ではテストをスキップする
        return;
    }

    const targetViaLink = path.join(linkPath, 'secret.ts');
    await assert.rejects(
        () => ImportPathValidator.resolveImportTargetPath(targetViaLink, [{ name: 'edcb', path: importRoot }]),
        /ImportPathNotAllowed/,
    );
});

test('resolveImportTargetPath rejects a path that does not exist', async () => {
    const dir = mkTmpDir();
    await assert.rejects(
        () => ImportPathValidator.resolveImportTargetPath(path.join(dir, 'missing.ts'), [{ name: 'edcb', path: dir }]),
        /ImportPathNotFound/,
    );
});
