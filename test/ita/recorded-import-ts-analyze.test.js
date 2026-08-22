'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const RecordedManageModel = require('../../dist/model/operator/recorded/RecordedManageModel').default;

// analyzeTsInfoForImport は tsInfoAnalyzer と log しか触らないため、
// DI 一式を組まずに prototype へ最小限の this を渡して検証する。
// RecordedManageModel は巨大で ut のカバレッジ計測に含めると全体を 80% ゲート未満へ
// 落とすため、他の取り込み系テストと同じく ita に置いている
function createContext(analyzeResult) {
    const analyzeCalls = [];
    const context = {
        analyzeCalls,
        tsInfoAnalyzer: {
            analyze: async filePath => {
                analyzeCalls.push(filePath);
                if (analyzeResult instanceof Error) {
                    throw analyzeResult;
                }

                return analyzeResult;
            },
        },
        log: {
            system: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        },
    };

    return context;
}

const analyzeTsInfoForImport = RecordedManageModel.prototype.analyzeTsInfoForImport;

test('取り込み: 拡張子が .ts なら fileType が encoded でも PSI/SI を解析する', async () => {
    // tsreplace 出力は映像だけ差し替えた .ts で、fileType は encoded で登録される。
    // ここで解析を飛ばすと firstTdtAt が取れず、実況同期用の startAt を補正できない
    const tsInfo = { firstTdtAt: 1700000000000, serviceId: 1024 };
    const context = createContext(tsInfo);

    const result = await analyzeTsInfoForImport.call(context, '/videos/anime (1).hevc.ts');

    assert.equal(result, tsInfo);
    assert.deepEqual(context.analyzeCalls, ['/videos/anime (1).hevc.ts']);
});

test('取り込み: 大文字の .TS も解析対象にする', async () => {
    const tsInfo = { firstTdtAt: 1700000000000 };
    const context = createContext(tsInfo);

    const result = await analyzeTsInfoForImport.call(context, '/videos/sample.TS');

    assert.equal(result, tsInfo);
    assert.equal(context.analyzeCalls.length, 1);
});

test('取り込み: PSI/SI を持たない .mp4 / .mkv は解析しない', async () => {
    for (const filePath of ['/videos/sample.mp4', '/videos/sample.mkv']) {
        const context = createContext({ firstTdtAt: 1 });

        const result = await analyzeTsInfoForImport.call(context, filePath);

        assert.equal(result, null);
        assert.deepEqual(context.analyzeCalls, []);
    }
});

test('取り込み: TS 解析に失敗しても例外を投げず null を返す', async () => {
    const context = createContext(new Error('broken ts'));

    const result = await analyzeTsInfoForImport.call(context, '/videos/broken.ts');

    assert.equal(result, null);
    assert.deepEqual(context.analyzeCalls, ['/videos/broken.ts']);
});
