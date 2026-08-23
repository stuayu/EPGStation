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

function createModel(storageRoot, recorded, deletedIds) {
    return new ThumbnailManageModel(
        logger,
        { getConfig: () => ({ thumbnail: storageRoot, thumbnailStorageRoot: storageRoot }) },
        { add: () => {} },
        { findId: async () => recorded },
        {},
        { deleteOnce: async id => deletedIds.push(id) },
        { emitDeleted: () => {}, emitAdded: () => {} },
        {},
    );
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
        model.add = (videoFileId, profile) => queued.push({ videoFileId, profile });

        await model.replaceRecorded(1, 100, 'quality');

        assert.deepEqual(deletedIds, [5]);
        await assert.rejects(fs.stat(path.join(storageRoot, 'old.jpg')), { code: 'ENOENT' });
        assert.deepEqual(queued, [{ videoFileId: 100, profile: 'quality' }]);
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
    const model = createModel('/unused', { id: 1, videoFiles: [{ id: 100 }], thumbnails: [] }, []);
    const calls = [];
    model.replaceRecorded = async (...args) => calls.push(args);

    await model.regenerateRecorded(1, 'fast');

    assert.deepEqual(calls, [[1, 100, 'fast']]);
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

const scenarios = {
    replaceRecorded,
    rejectForeignVideoFile,
    deleteThumbnail,
    regenerateRecorded,
    filenameAndSizeHelpers,
};
const scenario = scenarios[process.argv[2]];
if (scenario === undefined) {
    throw new Error(`UnknownScenario: ${process.argv[2]}`);
}
scenario().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
