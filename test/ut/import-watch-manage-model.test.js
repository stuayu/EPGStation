'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ImportWatchManageModel = require('../../dist/model/operator/recorded/ImportWatchManageModel').default;
const { getImportProgramId } = require('../../dist/util/ImportDuplicateMatcher');

const logger = { getLogger: () => ({ system: { info: () => {}, warn: () => {}, error: () => {} } }) };
const mkTmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'epgs18-watch-'));

function tsInfo(override = {}) {
    return {
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
        videoType: null,
        videoResolution: null,
        videoStreamContent: null,
        videoComponentType: null,
        audioSamplingRate: null,
        audioComponentType: null,
        videoStreamType: null,
        videoPid: null,
        audioStreamType: null,
        audioPid: null,
        firstTdtAt: null,
        bitSections: [],
        ...override,
    };
}

function build({
    dir,
    duplicateCandidates = [],
    analyzedTsInfo,
    registeredFiles = [],
    importExternal,
    configOverride = {},
    analyze,
}) {
    const channel = { id: 1, name: 'TOKYOMX', halfWidthName: 'TOKYOMX', serviceId: 2 };
    const config = {
        importDirs: [{ name: 'edcb', path: dir }],
        importDefaultMode: 'register',
        ...configOverride,
    };
    return {
        model: new ImportWatchManageModel(
            logger,
            { getConfig: () => config },
            {
                findAll: async () => [channel],
                findNetworkIdAndServiceId: async () => channel,
            },
            { findDuplicateCandidates: async () => duplicateCandidates },
            { importExternalRecordedFiles: importExternal },
            { analyze: analyze ?? (async () => analyzedTsInfo) },
            { findAll: async () => registeredFiles },
            { getFullFilePathFromVideoFile: video => path.join(dir, video.filePath) },
        ),
        channel,
    };
}

function candidate(filePath) {
    return { filePath, fileName: path.basename(filePath), programTxtPath: null, errPath: null };
}

test('監視はファイル名や program.txt で局を先に推定し expectedServiceId を TS 解析へ渡す', async () => {
    const dir = mkTmpDir();
    const file = path.join(dir, 'sample.ts');
    const programTxt = `${file}.program.txt`;
    fs.writeFileSync(file, 'x');
    fs.writeFileSync(programTxt, '番組名: 番組A\nチャンネル: TOKYOMX\n');
    let analyzeOption;
    const { model, channel } = build({
        dir,
        analyzedTsInfo: tsInfo({ eventName: '番組A', eventStartAt: 1800000000000 }),
        analyze: async (_filePath, option) => {
            analyzeOption = option;

            return tsInfo({ eventName: '番組A', eventStartAt: 1800000000000 });
        },
        importExternal: async () => [{ imported: true }],
    });

    await model.importCandidate({ ...candidate(file), programTxtPath: programTxt }, [channel]);

    assert.deepEqual(analyzeOption, { expectedServiceId: 2 });
});

test('監視は TS の強い一致を既存番組への add として共通取り込み処理へ渡す', async () => {
    const dir = mkTmpDir();
    const file = path.join(dir, 'sample.ts');
    fs.writeFileSync(file, 'x');
    const analyzed = tsInfo({
        networkId: 1,
        serviceId: 2,
        eventId: 3,
        serviceName: 'TOKYOMX',
        eventName: '番組Ａ',
        eventStartAt: 1800000000000,
    });
    let options;
    const { model, channel } = build({
        dir,
        analyzedTsInfo: analyzed,
        duplicateCandidates: [
            {
                id: 42,
                channelId: 1,
                startAt: analyzed.eventStartAt,
                name: '番組A',
                programId: getImportProgramId(analyzed),
            },
        ],
        importExternal: async value => {
            options = value[0];
            return [{ imported: true }];
        },
    });

    await model.importCandidate(candidate(file), [channel]);

    assert.equal(options.duplicateAction, 'add');
    assert.equal(options.duplicateRecordedId, 42);
});

test('監視は弱い重複候補を skip し、取り込み処理を呼ばない', async () => {
    const dir = mkTmpDir();
    const file = path.join(dir, 'sample.ts');
    fs.writeFileSync(file, 'x');
    let called = false;
    const { model, channel } = build({
        dir,
        analyzedTsInfo: tsInfo({ serviceName: 'TOKYOMX', eventStartAt: 1800000000000 }),
        duplicateCandidates: [{ id: 42, channelId: 1, startAt: 1800000000000, name: '別番組', programId: null }],
        importExternal: async () => ((called = true), []),
    });

    await model.importCandidate(candidate(file), [channel]);

    assert.equal(called, false);
});

test('監視は登録済みパスを番組推定なしで skip する', async () => {
    const dir = mkTmpDir();
    const file = path.join(dir, 'sample.mp4');
    fs.writeFileSync(file, 'x');
    let called = false;
    const { model, channel } = build({
        dir,
        analyzedTsInfo: null,
        duplicateCandidates: [],
        registeredFiles: [{ filePath: 'sample.mp4' }],
        importExternal: async () => ((called = true), []),
    });

    await model.importCandidate(candidate(file), [channel], new Set([file]));

    assert.equal(called, false);
});

test('監視は取り込み結果の error を seen に入れず、最大 3 回まで再試行する', async () => {
    const dir = mkTmpDir();
    const file = path.join(dir, 'sample.ts');
    fs.writeFileSync(file, 'x');
    const realFile = fs.realpathSync(file);
    let importCount = 0;
    const { model } = build({
        dir,
        analyzedTsInfo: tsInfo({ serviceName: 'TOKYOMX', eventStartAt: 1800000000000 }),
        importExternal: async () => {
            importCount++;

            return [{ imported: false, error: 'temporary failure' }];
        },
    });
    model.saveSeen = async () => {};

    await model.tick();
    assert.equal(model.seen.has(file), false);
    await model.tick();
    await model.tick();
    assert.equal(importCount, 3);
    assert.equal(model.seen.has(file), false);

    await model.tick();
    assert.equal(importCount, 3);
    assert.equal(model.seen.has(realFile), true);
});

test('監視は未処理候補が無い tick では登録済みパス索引を作らない', async () => {
    const dir = mkTmpDir();
    const file = path.join(dir, 'sample.ts');
    fs.writeFileSync(file, 'x');
    const realFile = fs.realpathSync(file);
    let findAllCount = 0;
    const { model } = build({
        dir,
        registeredFiles: [],
        analyzedTsInfo: null,
        importExternal: async () => [{ imported: true }],
    });
    model.videoFileDB.findAll = async () => {
        findAllCount++;

        return [];
    };
    model.seen = new Set([realFile]);
    model.saveSeen = async () => {};

    await model.tick();

    assert.equal(findAllCount, 0);
});

test('監視の move は録画ディレクトリを parentDirectoryName に渡し、register は取り込み元を渡す', async () => {
    const dir = mkTmpDir();
    const file = path.join(dir, 'sample.ts');
    fs.writeFileSync(file, 'x');
    const parentDirectoryNames = [];
    const { model, channel } = build({
        dir,
        analyzedTsInfo: tsInfo({ serviceName: 'TOKYOMX', eventStartAt: 1800000000000 }),
        configOverride: {
            importDefaultMode: 'move',
            recorded: [{ name: 'recorded', path: mkTmpDir() }],
        },
        importExternal: async items => {
            parentDirectoryNames.push(items[0].parentDirectoryName);

            return [{ imported: true }];
        },
    });

    await model.importCandidate(candidate(file), [channel]);
    const registerFile = path.join(dir, 'register.ts');
    fs.writeFileSync(registerFile, 'x');
    const register = build({
        dir,
        analyzedTsInfo: tsInfo({ serviceName: 'TOKYOMX', eventStartAt: 1800000000000 }),
        importExternal: async items => {
            parentDirectoryNames.push(items[0].parentDirectoryName);

            return [{ imported: true }];
        },
    });
    await register.model.importCandidate(candidate(registerFile), [register.channel]);

    assert.deepEqual(parentDirectoryNames, ['recorded', 'edcb']);
});
