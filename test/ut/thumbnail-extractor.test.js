'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const ThumbnailExtractor = require('../../dist/model/operator/thumbnail/ThumbnailExtractor').default;
const { resolveThumbnailProfile, shouldAnalyzeThumbnail } = require('../../dist/model/operator/thumbnail/ThumbnailManageModel');
const { resolveThumbnailSearchDuration } = require('../../dist/model/operator/thumbnail/ThumbnailSearchDuration');

const FRAME_BYTES = 320 * 180 * 3;

function childProcess() {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    return child;
}

test('候補抽出は input-side seek で全区間デコードを行わない', async () => {
    const calls = [];
    const extractor = new ThumbnailExtractor((bin, args) => {
        calls.push({ bin, args });
        const child = childProcess();
        process.nextTick(() => {
            child.stdout.write(Buffer.alloc(FRAME_BYTES));
            child.emit('exit', 0);
        });
        return child;
    });

    const frames = await extractor.extract('ffmpeg-test', 'input.ts', 100, 3);

    assert.equal(frames.length, 3);
    assert.deepEqual(frames.map(frame => frame.timestamp), [5, 50, 95]);
    for (const { bin, args } of calls) {
        assert.equal(bin, 'ffmpeg-test');
        assert.ok(args.indexOf('-ss') < args.indexOf('-i'));
        assert.equal(args.includes('-t'), false);
        assert.equal(args.some(arg => arg.startsWith('fps=')), false);
        assert.deepEqual(args.slice(args.indexOf('-frames:v'), args.indexOf('-frames:v') + 2), ['-frames:v', '1']);
    }
});

test('候補抽出の同時実行数は3以下', async () => {
    let active = 0;
    let maxActive = 0;
    const waiting = [];
    const extractor = new ThumbnailExtractor(() => {
        const child = childProcess();
        active++;
        maxActive = Math.max(maxActive, active);
        waiting.push(() => {
            active--;
            child.stdout.write(Buffer.alloc(FRAME_BYTES));
            child.emit('exit', 0);
        });
        return child;
    });

    const result = extractor.extract('ffmpeg', 'input.ts', 100, 8);
    while (waiting.length > 0 || active > 0) {
        const finish = waiting.shift();
        if (finish !== undefined) finish();
        await new Promise(resolve => setImmediate(resolve));
    }
    await result;
    assert.equal(maxActive, 3);
});

test('一部候補が失敗しても成功フレームを時刻順で返す', async () => {
    const extractor = new ThumbnailExtractor((_bin, args) => {
        const child = childProcess();
        const timestamp = Number(args[args.indexOf('-ss') + 1]);
        process.nextTick(() => {
            if (timestamp === 50) {
                child.stderr.write('broken frame');
                child.emit('exit', 1);
            } else {
                child.stdout.write(Buffer.alloc(FRAME_BYTES));
                child.emit('exit', 0);
            }
        });
        return child;
    });

    const frames = await extractor.extract('ffmpeg', 'input.ts', 100, 3);
    assert.deepEqual(frames.map(frame => frame.timestamp), [5, 95]);
});

test('全候補失敗時だけ抽出を reject する', async () => {
    const extractor = new ThumbnailExtractor(() => {
        const child = childProcess();
        process.nextTick(() => child.emit('exit', 1));
        return child;
    });
    await assert.rejects(extractor.extract('ffmpeg', 'input.ts', 100, 3), /ThumbnailExtractorAllCandidatesFailed/);
});

test('候補がtimeoutした場合はプロセスを停止して一度だけrejectする', async () => {
    let killed = 0;
    const extractor = new ThumbnailExtractor(() => {
        const child = childProcess();
        child.kill = () => { killed++; return true; };
        return child;
    });
    await assert.rejects(extractor.extract('ffmpeg', 'input.ts', 100, 1, 5, 5), /ThumbnailExtractorAllCandidatesFailed/);
    assert.equal(killed, 1);
});

test('サムネイルprofileは明示値、設定値、balancedの順で解決する', () => {
    assert.equal(resolveThumbnailProfile('quality', 'fast'), 'quality');
    assert.equal(resolveThumbnailProfile(undefined, 'fast'), 'fast');
    assert.equal(resolveThumbnailProfile(undefined, undefined), 'balanced');
    assert.equal(shouldAnalyzeThumbnail(resolveThumbnailProfile(undefined, 'fast')), false);
    assert.equal(shouldAnalyzeThumbnail(resolveThumbnailProfile('quality', 'fast')), true);
});

test('候補探索範囲は既定20分、設定上限、0なら全編で解決する', () => {
    assert.equal(resolveThumbnailSearchDuration(3600, undefined), 1200);
    assert.equal(resolveThumbnailSearchDuration(3600, 600), 600);
    assert.equal(resolveThumbnailSearchDuration(300, 1200), 300);
    assert.equal(resolveThumbnailSearchDuration(3600, 0), 3600);
    assert.equal(resolveThumbnailSearchDuration(3600, -1), 3600);
    assert.equal(resolveThumbnailSearchDuration(Number.NaN, 1200), 0);
});
