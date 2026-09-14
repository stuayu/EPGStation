'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    buildImportedVideoFilePathIndex,
    getImportProgramId,
    isSameImportFilePath,
    matchImportDuplicate,
    normalizeImportFilePath,
    normalizeImportProgramName,
} = require('../../dist/util/ImportDuplicateMatcher');

const TOLERANCE = 5 * 60 * 1000;
const baseInput = {
    channelId: 10,
    startAt: 1800000000000,
    name: '番組Ａ [字]',
    tsInfo: { networkId: 1, serviceId: 2, eventId: 3 },
};

const candidate = override => ({
    id: 42,
    channelId: 10,
    startAt: baseInput.startAt,
    name: '番組A',
    programId: getImportProgramId(baseInput.tsInfo),
    ...override,
});

test('programId 一致は番組名が違っても強い一致になる', () => {
    const result = matchImportDuplicate({ ...baseInput, name: '別表記' }, [candidate()], TOLERANCE);

    assert.equal(result.matchedRecordedId, 42);
    assert.equal(result.programId, 10000200003);
});

test('programId が両方あり不一致の候補は名前一致でも強い一致にしない', () => {
    const result = matchImportDuplicate(
        {
            channelId: 1,
            startAt: 1800000000000 + 300000,
            name: 'ショートアニメ',
            tsInfo: { networkId: 1, serviceId: 2, eventId: 4 },
        },
        [
            {
                id: 42,
                channelId: 1,
                startAt: 1800000000000,
                name: 'ショートアニメ',
                programId: 10000200003,
            },
        ],
        300000,
    );

    assert.equal(result.matchedRecordedId, null);
    assert.deepEqual(result.duplicateRecordedIds, [42]);
});

test('番組名と時刻の一致が候補1件なら強い一致になる', () => {
    const result = matchImportDuplicate(
        { ...baseInput, tsInfo: null },
        [candidate({ programId: null, startAt: baseInput.startAt + 1000 })],
        TOLERANCE,
    );

    assert.equal(result.matchedRecordedId, 42);
});

test('候補が複数ある場合は番組名が同じでも自動追加しない', () => {
    const result = matchImportDuplicate(
        { ...baseInput, tsInfo: null },
        [candidate({ id: 42, programId: null }), candidate({ id: 43, programId: null })],
        TOLERANCE,
    );

    assert.equal(result.matchedRecordedId, null);
    assert.deepEqual(result.duplicateRecordedIds, [42, 43]);
});

test('候補が複数で名前一致が1件だけでも自動追加しない', () => {
    const result = matchImportDuplicate(
        { ...baseInput, tsInfo: null },
        [candidate({ programId: null }), candidate({ id: 43, programId: null, name: '別番組' })],
        TOLERANCE,
    );

    assert.equal(result.matchedRecordedId, null);
});

test('時刻だけ一致する弱い重複は自動追加しない', () => {
    const result = matchImportDuplicate(
        { ...baseInput, tsInfo: null, name: '別番組' },
        [candidate({ programId: null })],
        TOLERANCE,
    );

    assert.equal(result.matchedRecordedId, null);
    assert.deepEqual(result.duplicateRecordedIds, [42]);
});

test('番組名の正規化は全半角・放送マーカー・空白を吸収する', () => {
    assert.equal(normalizeImportProgramName(' 番組Ａ [字] '), normalizeImportProgramName('番組A'));
});

test('番組名の正規化は話数の角括弧を保持し、放送マーカーだけを除去する', () => {
    assert.notEqual(normalizeImportProgramName('番組[第1話]'), normalizeImportProgramName('番組[第2話]'));
    assert.equal(normalizeImportProgramName('番組[字]'), normalizeImportProgramName('番組'));
    assert.equal(normalizeImportProgramName('番組【再】'), normalizeImportProgramName('番組'));
});

test('Windows パスは大文字小文字と区切り文字の差を無視する', () => {
    assert.equal(
        isSameImportFilePath('C:\\Recordings\\Show.TS', 'c:/recordings/show.ts'),
        true,
    );
});

test('登録済みパスの索引はディレクトリのシンボリックリンクを解決する', { skip: process.platform === 'win32' }, async () => {
    const realDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'import-dup-real-')));
    const linkDir = `${realDir}-link`;
    fs.symlinkSync(realDir, linkDir, 'dir');
    try {
        const index = await buildImportedVideoFilePathIndex([
            { filePath: path.join(linkDir, 'show.ts'), videoFileId: 1, recordedId: 2 },
            { filePath: path.join(linkDir, 'other.ts'), videoFileId: 3, recordedId: 2 },
        ]);

        assert.equal(index.get(normalizeImportFilePath(path.join(realDir, 'show.ts'))).videoFileId, 1);
        assert.equal(index.size, 2);
    } finally {
        fs.unlinkSync(linkDir);
        fs.rmSync(realDir, { recursive: true, force: true });
    }
});
