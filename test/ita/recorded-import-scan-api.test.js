'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const RecordedApiModel = require('../../dist/model/api/recorded/RecordedApiModel').default;

const mkTmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'epgs18-scan-'));

const itemUtil = { convertRecordedToRecordedItem: value => value };
const baseChannel = { id: 1, name: 'TOKYOMX', halfWidthName: 'TOKYOMX' };

/**
 * 何も取得できなかったときの TS 解析結果
 */
function emptyTsInfo(override) {
    return Object.assign(
        {
            networkId: null,
            transportStreamId: null,
            serviceId: null,
            serviceType: null,
            serviceName: null,
            serviceProviderName: null,
            networkName: null,
            eventId: null,
            eventName: null,
            eventDescription: null,
            eventExtended: null,
            eventStartAt: null,
            eventDuration: null,
            genres: [],
            videoStreamType: null,
            videoPid: null,
            audioStreamType: null,
            audioPid: null,
            firstTdtAt: null,
        },
        override,
    );
}

function buildModel({ enabled, importDirs, recordedDB, channelDB, tsInfoAnalyzer }) {
    return new RecordedApiModel(
        {},
        recordedDB ?? { findAll: async () => [[], 0], findId: async () => null, findIds: async () => [], findDuplicateCandidates: async () => [] },
        { getRecordedIndex: () => ({}) },
        itemUtil,
        { getConfig: () => ({ featureFlags: { externalFileImport: enabled }, importDirs, importFileNamePatterns: [] }) },
        { findByVideoFileIds: async () => [] },
        { findLink: async () => null, listRecorded: async () => [] },
        channelDB ?? { findAll: async () => [baseChannel], findNetworkIdAndServiceId: async () => null },
        // 既定では TS から何も取れなかった扱いにして、ファイル名からの推定を通す
        tsInfoAnalyzer ?? { analyze: async () => emptyTsInfo() },
    );
}

test('scan is rejected while the feature flag is off', async () => {
    const model = buildModel({ enabled: false, importDirs: [] });
    await assert.rejects(() => model.scanImportDirectory({ importDirName: 'edcb' }), /ExternalFileImportFeatureIsDisabled/);
});

test('scan rejects an unknown importDirName', async () => {
    const model = buildModel({ enabled: true, importDirs: [{ name: 'edcb', path: mkTmpDir() }] });
    await assert.rejects(() => model.scanImportDirectory({ importDirName: 'unknown' }), /ImportDirNotFound/);
});

test('scan finds candidate files and estimates channel/name from the file name', async () => {
    const dir = mkTmpDir();
    fs.writeFileSync(path.join(dir, '202607262100_サンプル番組_TOKYOMX.ts'), 'x');

    const model = buildModel({ enabled: true, importDirs: [{ name: 'edcb', path: dir }] });
    const result = await model.scanImportDirectory({ importDirName: 'edcb' });

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].estimatedName, 'サンプル番組');
    assert.equal(result.items[0].estimatedChannelName, 'TOKYOMX');
    assert.equal(result.items[0].estimatedChannelId, 1);
    assert.equal(result.items[0].hasProgramTxt, false);
});

test('scan flags a candidate as a possible duplicate when a matching recorded exists', async () => {
    const dir = mkTmpDir();
    fs.writeFileSync(path.join(dir, '202607262100_サンプル番組_TOKYOMX.ts'), 'x');

    const recordedDB = {
        findDuplicateCandidates: async () => [{ id: 42 }],
    };
    const model = buildModel({ enabled: true, importDirs: [{ name: 'edcb', path: dir }], recordedDB });
    const result = await model.scanImportDirectory({ importDirName: 'edcb' });

    assert.deepEqual(result.items[0].duplicateRecordedIds, [42]);
});

test('scan rejects a subPath that escapes the import directory', async () => {
    const dir = mkTmpDir();
    const model = buildModel({ enabled: true, importDirs: [{ name: 'edcb', path: dir }] });
    await assert.rejects(() => model.scanImportDirectory({ importDirName: 'edcb', subPath: '../../etc' }), /InvalidSubDirectory/);
});


test('TS から放送局と番組名が取れた場合はそれを推定値にする', async () => {
    const dir = mkTmpDir();
    fs.writeFileSync(path.join(dir, '202607262100_サンプル番組_TOKYOMX.ts'), 'x');

    const model = buildModel({
        enabled: true,
        importDirs: [{ name: 'edcb', path: dir }],
        channelDB: {
            findAll: async () => [baseChannel],
            findNetworkIdAndServiceId: async (networkId, serviceId) =>
                networkId === 32416 && serviceId === 21504 ? { id: 3241621504 } : null,
        },
        tsInfoAnalyzer: {
            analyze: async () =>
                emptyTsInfo({
                    networkId: 32416,
                    serviceId: 21504,
                    serviceName: 'ＮＨＫ総合１・福島',
                    eventName: 'ＴＳ から取れた番組名',
                    eventStartAt: 1800000000000,
                    eventDuration: 1800,
                }),
        },
    });

    const result = await model.scanImportDirectory({ importDirName: 'edcb' });

    assert.equal(result.items.length, 1);
    const item = result.items[0];
    assert.equal(item.estimatedSource, 'ts');
    assert.equal(item.estimatedName, 'ＴＳ から取れた番組名');
    assert.equal(item.estimatedChannelName, 'ＮＨＫ総合１・福島');
    // 放送局名の曖昧一致 (TOKYOMX) ではなく network id + service id で引いた放送局になる
    assert.equal(item.estimatedChannelId, 3241621504);
    assert.equal(item.estimatedStartAt, 1800000000000);
    assert.equal(item.estimatedEndAt, 1800000000000 + 1800 * 1000);
    assert.equal(item.tsServiceName, 'ＮＨＫ総合１・福島');
    assert.equal(item.tsNetworkId, 32416);
    assert.equal(item.tsServiceId, 21504);
});

test('TS から何も取れない場合はファイル名からの推定にフォールバックする', async () => {
    const dir = mkTmpDir();
    fs.writeFileSync(path.join(dir, '202607262100_サンプル番組_TOKYOMX.ts'), 'x');

    const model = buildModel({ enabled: true, importDirs: [{ name: 'edcb', path: dir }] });

    const result = await model.scanImportDirectory({ importDirName: 'edcb' });

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].estimatedSource, 'fileName');
    assert.equal(result.items[0].estimatedChannelId, baseChannel.id);
});
