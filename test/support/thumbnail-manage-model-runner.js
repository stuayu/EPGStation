'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ThumbnailManageModel = require('../../dist/model/operator/thumbnail/ThumbnailManageModel').default;

const logger = {
    getLogger: () => ({
        system: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    }),
};

function createModel(storageRoot, recorded, deletedIds, queue = { add: () => {} }, videoUtil = {}) {
    return new ThumbnailManageModel(
        logger,
        { getConfig: () => ({ thumbnail: storageRoot, thumbnailStorageRoot: storageRoot }) },
        queue,
        { findId: async () => recorded },
        {},
        {
            deleteOnce: async id => deletedIds.push(id),
            findByRecordedIdAndVariant: async () => null,
            replaceOnce: async () => 1,
        },
        { emitDeleted: () => {}, emitAdded: () => {} },
        videoUtil,
    );
}

async function createFailureThenQueueProgresses() {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'epgstation-thumbnail-failure-'));
    const command = path.join(storageRoot, 'thumbnail-command.js');
    try {
        await fs.writeFile(command, "require('node:fs').writeFileSync(process.argv[2], 'poster');\n");
        const records = new Map([
            [1, { id: 1, videoFiles: [{ id: 101, type: 'ts', duration: 60 }] }],
            [2, { id: 2, videoFiles: [{ id: 102, type: 'ts', duration: 60 }] }],
        ]);
        const jobs = [];
        const deletedIds = [];
        const replaced = [];
        const model = createModel(
            storageRoot,
            null,
            deletedIds,
            { add: job => jobs.push(job) },
            { getFullFilePathFromId: async id => path.join(storageRoot, `${id}.ts`) },
        );
        model.config.thumbnailCmd = `${process.execPath} ${command} %OUTPUT%`;
        model.config.ffmpeg = process.execPath;
        model.config.thumbnailSize = '16x9';
        model.recordedDB.findId = async id => records.get(id) ?? null;
        model.thumbnailDB.replaceOnce = async thumbnail => {
            replaced.push({ id: thumbnail.recordedId, variant: thumbnail.variant });
            return replaced.length;
        };
        model.thumbnailDB.deleteOnce = async id => deletedIds.push(id);
        model.resize = async (_input, output, width) => {
            if (width === 640 && output.includes(`${path.sep}1-wide.`)) throw new Error('resize failed');
        };

        model.add(1);
        model.add(2);
        await jobs[0]();
        assert.deepEqual(deletedIds, [1]);
        await jobs[1]();
        assert.deepEqual(replaced, [
            { id: 1, variant: 'poster' },
            { id: 2, variant: 'poster' },
            { id: 2, variant: 'wide' },
        ]);
        model.add(1);
        assert.equal(jobs.length, 3);
    } finally {
        await fs.rm(storageRoot, { recursive: true, force: true });
    }
}

async function metaFailureRejectsAndRollsBack() {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'epgstation-thumbnail-meta-failure-'));
    const command = path.join(storageRoot, 'thumbnail-command.js');
    try {
        await fs.writeFile(command, "require('node:fs').writeFileSync(process.argv[2], 'poster');\n");
        await fs.writeFile(path.join(storageRoot, 'meta'), 'not a directory');
        const deletedIds = [];
        const model = createModel(
            storageRoot,
            { id: 1, videoFiles: [{ id: 101, type: 'ts', duration: 60 }] },
            deletedIds,
            {},
            { getFullFilePathFromId: async () => path.join(storageRoot, '101.ts') },
        );
        model.config.thumbnailCmd = `${process.execPath} ${command} %OUTPUT%`;
        model.config.ffmpeg = process.execPath;
        model.config.thumbnailSize = '16x9';
        model.thumbnailDB.replaceOnce = async thumbnail => (thumbnail.variant === 'poster' ? 11 : 12);
        model.thumbnailDB.deleteOnce = async id => deletedIds.push(id);
        model.resize = async () => {};

        await assert.rejects(model.create(1), /EEXIST|ENOTDIR/);
        assert.deepEqual(deletedIds, [12, 11]);
        await assert.rejects(fs.stat(path.join(storageRoot, '1-poster.jpg')), { code: 'ENOENT' });
    } finally {
        await fs.rm(storageRoot, { recursive: true, force: true });
    }
}

async function rollbackKeepsRestoredThumbnailFile() {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'epgstation-thumbnail-rollback-'));
    const command = path.join(storageRoot, 'thumbnail-command.js');
    try {
        await fs.writeFile(command, "require('node:fs').writeFileSync(process.argv[2], 'poster');\n");
        await fs.writeFile(path.join(storageRoot, 'meta'), 'not a directory');
        const deletedIds = [];
        const restored = [];
        // 旧世代は再生成後と同じファイル名 (録画 id 由来) を指す
        const currentPoster = { id: 21, recordedId: 1, variant: 'poster', filePath: '1-poster.jpg' };
        const model = createModel(
            storageRoot,
            { id: 1, videoFiles: [{ id: 101, type: 'ts', duration: 60 }] },
            deletedIds,
            {},
            { getFullFilePathFromId: async () => path.join(storageRoot, '101.ts') },
        );
        model.config.thumbnailCmd = `${process.execPath} ${command} %OUTPUT%`;
        model.config.ffmpeg = process.execPath;
        model.config.thumbnailSize = '16x9';
        model.thumbnailDB.findByRecordedIdAndVariant = async (_recordedId, variant) =>
            variant === 'poster' ? currentPoster : null;
        model.thumbnailDB.replaceOnce = async thumbnail => {
            if (thumbnail === currentPoster) {
                restored.push(thumbnail.id);

                return thumbnail.id;
            }

            return thumbnail.variant === 'poster' ? 11 : 12;
        };
        model.thumbnailDB.deleteOnce = async id => deletedIds.push(id);
        model.resize = async () => {};

        await assert.rejects(model.create(1), /EEXIST|ENOTDIR/);
        assert.deepEqual(deletedIds, [12, 11]);
        assert.deepEqual(restored, [21]);
        // 復元した行が指すファイルは残す (消すと画像の無い行になる)
        const stat = await fs.stat(path.join(storageRoot, '1-poster.jpg'));
        assert.ok(stat.isFile());
    } finally {
        await fs.rm(storageRoot, { recursive: true, force: true });
    }
}

async function replaceRecorded() {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'epgstation-thumbnail-'));
    try {
        await fs.writeFile(path.join(storageRoot, 'old.jpg'), 'old');
        const deletedIds = [];
        const queued = [];
        const model = createModel(
            storageRoot,
            {
                id: 1,
                videoFiles: [{ id: 10 }, { id: 100 }],
                thumbnails: [{ id: 5, filePath: 'old.jpg' }],
            },
            deletedIds,
        );
        model.add = (recordedId, profile) => queued.push({ recordedId, profile });

        await model.replaceRecorded(1, 100, 'quality');

        assert.deepEqual(deletedIds, [5]);
        await assert.rejects(fs.stat(path.join(storageRoot, 'old.jpg')), { code: 'ENOENT' });
        assert.deepEqual(queued, [{ recordedId: 1, profile: 'quality' }]);
    } finally {
        await fs.rm(storageRoot, { recursive: true, force: true });
    }
}

async function rejectForeignVideoFile() {
    const deletedIds = [];
    const model = createModel(
        '/unused',
        { id: 1, videoFiles: [{ id: 10 }], thumbnails: [{ id: 5, filePath: 'old.jpg' }] },
        deletedIds,
    );

    await assert.rejects(model.replaceRecorded(1, 100), /VideoFileIsNotFound/);
    assert.deepEqual(deletedIds, []);
}

async function deleteThumbnail() {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'epgstation-thumbnail-delete-'));
    try {
        await fs.writeFile(path.join(storageRoot, 'delete.jpg'), 'old');
        const deletedIds = [];
        const model = createModel(storageRoot, null, deletedIds);
        model.thumbnailDB.findId = async () => ({ id: 5, filePath: 'delete.jpg' });
        let emitted = false;
        model.thumbnailEvent.emitDeleted = () => {
            emitted = true;
        };

        await model.delete(5);

        assert.deepEqual(deletedIds, [5]);
        await assert.rejects(fs.stat(path.join(storageRoot, 'delete.jpg')), { code: 'ENOENT' });
        assert.equal(emitted, true);
    } finally {
        await fs.rm(storageRoot, { recursive: true, force: true });
    }
}

async function regenerateRecorded() {
    const model = createModel('/unused', { id: 1, videoFiles: [{ id: 100, type: 'ts' }], thumbnails: [] }, []);
    const calls = [];
    model.replaceRecorded = async (...args) => calls.push(args);

    await model.regenerateRecorded(1, 'fast');

    assert.deepEqual(calls, [[1, 100, 'fast']]);
}

async function regenerateRecordedPrefersLatestEncoded() {
    const model = createModel('/unused', {
        id: 1,
        videoFiles: [
            { id: 100, type: 'ts' },
            { id: 101, type: 'encoded' },
            { id: 105, type: 'encoded' },
        ],
        thumbnails: [],
    }, []);
    const calls = [];
    model.replaceRecorded = async (...args) => calls.push(args);

    await model.regenerateRecorded(1, 'quality');
    assert.deepEqual(calls, [[1, 105, 'quality']]);
}

async function chaptersOnlyForEncoded() {
    const calls = [];
    const videoUtil = { getChapters: async filePath => {
        calls.push(filePath);
        return [{ id: 1, title: 'CM', startAt: 0, endAt: 10 }];
    } };
    const model = createModel('/unused', null, [], { add: () => {} }, videoUtil);
    const candidates = [{ timestamp: 5, index: 0 }, { timestamp: 15, index: 1 }];

    assert.deepEqual(
        await model.filterCandidatesForVideoFile({ id: 1, type: 'ts' }, 'raw.ts', candidates, 20, 2),
        candidates,
    );
    assert.deepEqual(calls, []);
    const filtered = await model.filterCandidatesForVideoFile(
        { id: 2, type: 'encoded' }, 'encoded.mp4', candidates, 20, 2,
    );
    assert.deepEqual(calls, ['encoded.mp4']);
    assert.deepEqual(filtered.map(candidate => candidate.timestamp), [15]);
}

async function chapterFailureContinues() {
    const model = createModel('/unused', null, [], { add: () => {} }, {
        getChapters: async () => { throw new Error('ffprobe failed'); },
    });
    const candidates = [{ timestamp: 5, index: 0 }];
    assert.deepEqual(
        await model.filterCandidatesForVideoFile({ id: 2, type: 'encoded' }, 'encoded.mp4', candidates, 20, 1),
        candidates,
    );
}

async function filenameAndSizeHelpers() {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'epgstation-thumbnail-name-'));
    try {
        const model = createModel(storageRoot, null, []);
        model.config.thumbnailPosterWidth = 640;
        model.config.thumbnailSize = '16x9';
        await fs.writeFile(path.join(storageRoot, '1-jpg'), 'old');

        assert.equal(await model.getSaveFileName(1), '1(1)-jpg');
        assert.equal(model.parseWidth('320x180'), 320);
        assert.equal(model.parseHeight('320x180'), 180);
        assert.equal(model.parseWidth('invalid'), null);
        assert.equal(model.getPosterSize(), '640x360');
    } finally {
        await fs.rm(storageRoot, { recursive: true, force: true });
    }
}

async function duplicateQueue() {
    const jobs = [];
    const model = createModel('/unused', null, [], { add: job => jobs.push(job) });
    let resolveCreate;
    model.create = () => new Promise(resolve => { resolveCreate = resolve; });

    model.add(10);
    model.add(10);
    assert.equal(jobs.length, 1);
    const running = jobs[0]();
    model.add(10);
    assert.equal(jobs.length, 1);
    resolveCreate();
    await running;
    model.add(10);
    assert.equal(jobs.length, 2);
}

async function failedQueueCanRetry() {
    const jobs = [];
    const model = createModel('/unused', null, [], { add: job => jobs.push(job) });
    model.create = async () => { throw new Error('expected failure'); };

    model.add(10);
    await jobs[0]();
    model.add(10);
    assert.equal(jobs.length, 2);
}

const scenarios = {
    replaceRecorded,
    rejectForeignVideoFile,
    deleteThumbnail,
    regenerateRecorded,
    regenerateRecordedPrefersLatestEncoded,
    chaptersOnlyForEncoded,
    chapterFailureContinues,
    filenameAndSizeHelpers,
    duplicateQueue,
    failedQueueCanRetry,
    createFailureThenQueueProgresses,
    metaFailureRejectsAndRollsBack,
    rollbackKeepsRestoredThumbnailFile,
};
const scenario = scenarios[process.argv[2]];
if (scenario === undefined) {
    throw new Error(`UnknownScenario: ${process.argv[2]}`);
}
scenario().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
