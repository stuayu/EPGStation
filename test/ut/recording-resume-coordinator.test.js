'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const RecordingResumeCoordinator = require('../../dist/model/operator/recording/RecordingResumeCoordinator').default;

const resumeInfo = parentDirectoryName => ({
    videoFile: { parentDirectoryName, filePath: path.join('folder', 'resume.ts'), size: 376 },
    attempts: [
        { closeReason: 'transport-lost', endedAt: 10, firstDataAt: 20 },
        { closeReason: null, endedAt: null, firstDataAt: 30 },
    ],
});

test('tmp 録画の保存先と復帰 attempt 集計を組み立てる', () => {
    const result = RecordingResumeCoordinator.prepare(resumeInfo('tmp'), {
        recordedTmp: '/recording/tmp',
        recorded: [],
    });
    assert.deepEqual(result, {
        filePath: path.join('/recording/tmp', 'folder', 'resume.ts'),
        fileOffset: 376,
        attemptCount: 2,
        gapCount: 1,
        closeReasons: ['transport-lost', null],
    });
});

test('登録済み録画先を選び、保存先が不明なら復帰しない', () => {
    const info = resumeInfo('archive');
    assert.equal(
        RecordingResumeCoordinator.prepare(info, {
            recordedTmp: '/recording/tmp',
            recorded: [{ name: 'archive', path: '/recording/archive' }],
        }).filePath,
        path.join('/recording/archive', 'folder', 'resume.ts'),
    );
    assert.equal(RecordingResumeCoordinator.prepare(info, { recordedTmp: '/recording/tmp', recorded: [] }), null);
});
