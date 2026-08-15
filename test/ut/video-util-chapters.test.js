'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VideoUtil = require('../../dist/model/api/video/VideoUtil').default;

// ffprobe の出力からチャプター・音声トラックを組み立てる処理を検証する。
// 実際に ffprobe を起動する代わりに、child_process.execFile を差し替えて出力を注入する。

const cp = require('node:child_process');

/**
 * execFile を差し替えて任意の JSON を ffprobe の出力として返す
 * @param responder: (args) => string | Error 引数に応じた stdout (Error なら失敗させる)
 * @param fn: () => Promise<void>
 */
async function withStubbedFfprobe(responder, fn) {
    const original = cp.execFile;
    cp.execFile = (file, args, options, callback) => {
        // options を省略した呼び出しにも対応する
        const cb = typeof options === 'function' ? options : callback;
        const result = responder(args);
        setImmediate(() => {
            if (result instanceof Error) {
                cb(result, '', '');
            } else {
                cb(null, result, '');
            }
        });

        return {};
    };

    try {
        await fn();
    } finally {
        cp.execFile = original;
    }
}

function makeVideoUtil() {
    const configuration = { getConfig: () => ({ ffprobe: 'ffprobe', recorded: [] }) };

    return new VideoUtil(configuration, {});
}

test('start_time / end_time から秒単位のチャプターを組み立てる', async () => {
    const output = JSON.stringify({
        chapters: [
            { id: 0, time_base: '1/1000', start: 0, start_time: '0.000000', end: 5000, end_time: '5.000000', tags: { title: 'OP' } },
            { id: 1, time_base: '1/1000', start: 5000, start_time: '5.000000', end: 15000, end_time: '15.000000' },
        ],
    });

    await withStubbedFfprobe(
        () => output,
        async () => {
            const chapters = await makeVideoUtil().getChapters('/fake/video.mp4');
            assert.deepEqual(chapters, [
                { id: 0, startAt: 0, endAt: 5, title: 'OP' },
                // title タグが無いチャプターは null になる
                { id: 1, startAt: 5, endAt: 15, title: null },
            ]);
        },
    );
});

test('start_time が無い場合は time_base × start から算出する', async () => {
    const output = JSON.stringify({
        chapters: [{ id: 0, time_base: '1/1000', start: 3000, end: 9000 }],
    });

    await withStubbedFfprobe(
        () => output,
        async () => {
            const chapters = await makeVideoUtil().getChapters('/fake/video.mp4');
            assert.equal(chapters.length, 1);
            assert.equal(chapters[0].startAt, 3);
            assert.equal(chapters[0].endAt, 9);
        },
    );
});

test('チャプターが無いファイルは空配列を返す', async () => {
    await withStubbedFfprobe(
        () => JSON.stringify({ chapters: [] }),
        async () => {
            assert.deepEqual(await makeVideoUtil().getChapters('/fake/video.mp4'), []);
        },
    );
});

test('音声 ES が 1 つのステレオは主音声・副音声へ展開する (二か国語放送のデュアルモノラル対策)', async () => {
    const output = JSON.stringify({
        streams: [{ codec_name: 'aac', channels: 2, tags: { language: 'jpn' } }],
    });

    await withStubbedFfprobe(
        () => output,
        async () => {
            const tracks = await makeVideoUtil().getAudioTracks('/fake/video.ts');
            assert.equal(tracks.length, 2);
            assert.deepEqual(
                tracks.map(t => [t.track, t.name, t.isDualMono, t.streamIndex]),
                [
                    ['main', '主音声', true, 0],
                    ['sub', '副音声 (デュアルモノラル)', true, 0],
                ],
            );
        },
    );
});

test('音声 ES が複数ある場合はそれぞれ独立したトラックとして返す', async () => {
    const output = JSON.stringify({
        streams: [
            { codec_name: 'aac', channels: 2 },
            { codec_name: 'aac', channels: 2, tags: { title: '解説' } },
        ],
    });

    await withStubbedFfprobe(
        () => output,
        async () => {
            const tracks = await makeVideoUtil().getAudioTracks('/fake/video.ts');
            assert.deepEqual(
                tracks.map(t => [t.track, t.name, t.isDualMono]),
                [
                    ['0', '主音声', false],
                    // タイトルタグがあればそれを表示名に使う
                    ['1', '解説', false],
                ],
            );
        },
    );
});

test('モノラル 1 本だけの場合は展開しない (デュアルモノラルではありえないため)', async () => {
    await withStubbedFfprobe(
        () => JSON.stringify({ streams: [{ codec_name: 'aac', channels: 1 }] }),
        async () => {
            const tracks = await makeVideoUtil().getAudioTracks('/fake/video.ts');
            assert.equal(tracks.length, 1);
            assert.equal(tracks[0].track, '0');
            assert.equal(tracks[0].isDualMono, false);
        },
    );
});

test('ffprobe が失敗したら reject する', async () => {
    await withStubbedFfprobe(
        () => new Error('ffprobe failed'),
        async () => {
            await assert.rejects(() => makeVideoUtil().getChapters('/fake/video.mp4'));
            await assert.rejects(() => makeVideoUtil().getAudioTracks('/fake/video.mp4'));
        },
    );
});
